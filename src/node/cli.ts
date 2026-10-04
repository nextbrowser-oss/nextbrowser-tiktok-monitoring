// tiktok-monitor: run the monitor against one Nextbrowser profile from a
// terminal.
//
// Events go to stdout, one JSON object per line (or readable lines with
// --format text), so another process can follow them; the log goes to stderr
// with --verbose. The state lives in a file between runs.

import { parseArgs } from "node:util";
import { runPass, type PassSummary } from "../engine.js";
import type { MonitorEvent } from "../events.js";
import { splitKeywords } from "../keywords.js";
import type { LogEntry } from "../log.js";
import { DEFAULT_INTERVAL_MS, scheduleDelay } from "../schedule.js";
import { normalizeHandle, withSettings, type EngagementThresholds, type MonitorSettings, type MonitorState, type SettingsPatch } from "../state.js";
import { nbcBrowser } from "./nbc.js";
import { defaultStatePath, loadState, saveState } from "./store.js";

const USAGE = `tiktok-monitor — watch TikTok creators, your videos and their comments through a Nextbrowser profile

Usage:
  tiktok-monitor run   --profile NAME [options]   pass after pass until stopped
  tiktok-monitor once  --profile NAME [options]   one pass
  tiktok-monitor state --profile NAME [--state FILE]   print the saved state

Public creators are read signed out too. Sign the profile in to tiktok.com
for your own videos, the comments on them, and mentions of your account.

What is watched:
  --creators a,b           creators to watch (competitors, partners), with or without @
  --keywords "a,b c"       words, phrases and hashtags to find in descriptions and comments
  --exclude "a,b"          words that drop an item even when a keyword matched
  --urgent-terms "a,b"     terms that make an item urgent (default: a built-in list)
  --no-own / --own                 your own newest videos and their comments (default: yes)
  --no-comments / --comments       comment lists at all (default: yes)
  --no-engagement / --engagement   jumps in a video's views, likes and comments (default: yes)
  --no-followers / --followers     follower counts (default: yes)

How much:
  --interval 30m           between passes (min 10m, spread ±20%)
  --own-videos 6           your newest videos watched (0-12)
  --videos-per-creator 3   each creator's newest videos opened for counts and comments (0-10)
  --max-comment-reads 10   comment lists one pass may read (0-30)
  --views-jump 1000        views a video must gain (and +50%) to count as a jump
  --likes-jump 500         likes a video must gain (and +50%) to count as a jump
  --comments-jump 20       comments a video must gain to count as a jump
  --max-age 72h            older items are not announced

Browser:
  --nbc PATH               nbc or nextctl binary (default: the app's, then PATH)
  --runtime-root DIR       the app's runtime root (default: the app's)
  --runtime NAME           nbc --runtime for the profile
  --no-start               do not start the profile; fail if it is not running
  --keep-tab               leave the last page open instead of about:blank

Output:
  --state FILE             state file (default ~/.nextbrowser/tiktok-monitoring/<profile>.json)
  --format json|text       stdout format (default: text on a terminal, json otherwise)
  --verbose                write the monitor's log to stderr as JSON lines

Settings given as flags are saved in the state file and kept for later runs.
`;

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value: string, flag: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`${flag}: "${value}" is not a duration like 90s, 30m or 2h`);
  return Math.round(Number(match[1]) * UNIT_MS[match[2] ?? "s"]!);
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag}: "${value}" is not a whole number`);
  return number;
}

const OPTIONS = {
  profile: { type: "string" },
  state: { type: "string" },
  interval: { type: "string" },
  creators: { type: "string" },
  keywords: { type: "string" },
  exclude: { type: "string" },
  "urgent-terms": { type: "string" },
  "own-videos": { type: "string" },
  "videos-per-creator": { type: "string" },
  "max-comment-reads": { type: "string" },
  "views-jump": { type: "string" },
  "likes-jump": { type: "string" },
  "comments-jump": { type: "string" },
  "max-age": { type: "string" },
  own: { type: "boolean" },
  "no-own": { type: "boolean" },
  comments: { type: "boolean" },
  "no-comments": { type: "boolean" },
  engagement: { type: "boolean" },
  "no-engagement": { type: "boolean" },
  followers: { type: "boolean" },
  "no-followers": { type: "boolean" },
  nbc: { type: "string" },
  "runtime-root": { type: "string" },
  runtime: { type: "string" },
  "no-start": { type: "boolean" },
  "keep-tab": { type: "boolean" },
  format: { type: "string" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

/** toggle reads a --x / --no-x pair; the negative wins when both are given. */
function toggle(values: Values, name: string): boolean | undefined {
  const record = values as Record<string, unknown>;
  if (record[`no-${name}`]) return false;
  if (record[name]) return true;
  return undefined;
}

/** settingsFromFlags is the settings patch the flags ask for. */
export function settingsFromFlags(values: Values): SettingsPatch {
  const patch: SettingsPatch = {};
  const toggles: [string, keyof MonitorSettings][] = [
    ["own", "watchOwnVideos"],
    ["comments", "watchComments"],
    ["engagement", "trackEngagement"],
    ["followers", "trackFollowers"],
  ];
  for (const [flag, setting] of toggles) {
    const value = toggle(values, flag);
    if (value !== undefined) (patch as Record<string, unknown>)[setting] = value;
  }
  if (values.creators !== undefined) {
    const handles = values.creators.split(/[\s,]+/).filter(Boolean);
    const invalid = handles.filter((handle) => !normalizeHandle(handle));
    if (invalid.length) throw new Error(`--creators: not a TikTok username: ${invalid.join(", ")}`);
    patch.creators = handles.map(normalizeHandle);
  }
  if (values.keywords !== undefined) patch.keywords = splitKeywords(values.keywords);
  if (values.exclude !== undefined) patch.excludeKeywords = splitKeywords(values.exclude);
  if (values["urgent-terms"] !== undefined) patch.urgentTerms = splitKeywords(values["urgent-terms"]);
  if (values["own-videos"] !== undefined) patch.ownVideos = positiveInteger(values["own-videos"], "--own-videos");
  if (values["videos-per-creator"] !== undefined) patch.videosPerCreator = positiveInteger(values["videos-per-creator"], "--videos-per-creator");
  if (values["max-comment-reads"] !== undefined) patch.maxCommentReads = positiveInteger(values["max-comment-reads"], "--max-comment-reads");
  const engagement: Partial<EngagementThresholds> = {};
  if (values["views-jump"] !== undefined) engagement.viewsMin = positiveInteger(values["views-jump"], "--views-jump");
  if (values["likes-jump"] !== undefined) engagement.likesMin = positiveInteger(values["likes-jump"], "--likes-jump");
  if (values["comments-jump"] !== undefined) engagement.commentsMin = positiveInteger(values["comments-jump"], "--comments-jump");
  if (Object.keys(engagement).length) patch.engagement = engagement;
  if (values["max-age"] !== undefined) patch.maxItemAgeMs = parseDuration(values["max-age"], "--max-age");
  if (values["keep-tab"]) patch.parkTab = false;
  return patch;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : /(s|sh|ch|x)$/.test(noun) ? `${noun}es` : `${noun}s`}`;
}

function oneLine(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function signed(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")}`;
}

const LEVEL = { high: "HIGH", medium: "MEDIUM", low: "low" } as const;

/** describeEvent is the readable text for an event. A new item takes two
 *  lines: what and how urgent, then why and where to open it. */
export function describeEvent(event: MonitorEvent): string {
  switch (event.type) {
    case "new_item": {
      const { item, source, triage } = event;
      const who = `@${item.author}`;
      let what: string;
      if (item.kind === "video") {
        what = item.addressed === "mention" ? `${who} mentioned you in a video` : `${who} posted a video`;
      } else {
        const under = source.kind === "creator_comments" ? ` under ${source.name}'s video` : "";
        what = item.addressed === "mention"
          ? `${who} mentioned you${under}`
          : item.addressed === "reply"
            ? `${who} replied to you${under}`
            : item.addressed === "comment_on_video"
              ? `${who} commented on your video`
              : `${who} commented${under}`;
      }
      const body = oneLine(item.text) || (item.kind === "video" ? "[no description]" : "[no text]");
      const why = triage.reasons.length ? `[${triage.reasons.join(" · ")}]  ` : "";
      return `${time(event.at)}  ${LEVEL[triage.urgency].padEnd(6)}  ${what}: ${body}\n        ${why}${item.url}`;
    }
    case "engagement_changed":
      return `${time(event.at)}  ${event.metric} @${event.handle}${event.own ? " (you)" : ""}: ${event.previous.toLocaleString("en-US")} → ${event.current.toLocaleString("en-US")} (${signed(event.delta)})${event.approximate ? ", rounded" : ""}\n        ${event.url}`;
    case "followers_changed":
      return `${time(event.at)}  followers @${event.handle}${event.own ? " (you)" : ""}: ${event.previous.toLocaleString("en-US")} → ${event.current.toLocaleString("en-US")} (${signed(event.delta)})`;
    case "signed_in":
      return `${time(event.at)}  signed in${event.handle ? ` as @${event.handle}` : ""}`;
    case "signed_out":
      return `${time(event.at)}  signed out${event.handle ? ` (was @${event.handle})` : ""}: creators are still read; sign in to tiktok.com for your own videos`;
    case "account_changed":
      return `${time(event.at)}  account changed: @${event.previous} → @${event.current}; your videos start over`;
    case "security_check":
      return `${time(event.at)}  captcha${event.handle ? ` for @${event.handle}` : ""}: open tiktok.com in the profile and solve it`;
  }
}

/** describePass is the readable line for a finished pass. */
export function describePass(summary: PassSummary, at: number): string {
  const parts: string[] = [];
  if (summary.loginRequired) parts.push("not signed in");
  if (summary.sourcesRead) {
    const baseline = summary.baselines === summary.sourcesRead;
    parts.push(baseline
      ? `starting line: ${plural(summary.sourcesRead, "source")}, ${plural(summary.matches, "match")}`
      : `${plural(summary.sourcesRead, "source")}: ${summary.newItems} new${summary.urgent ? ` (${summary.urgent} urgent)` : ""} of ${plural(summary.matches, "match")}`);
  }
  const reads = [
    summary.videoReads ? `${plural(summary.videoReads, "video")}${summary.partialVideos ? ` (${summary.partialVideos} from the grid)` : ""}` : "",
    summary.commentReads ? plural(summary.commentReads, "comment list") : "",
  ].filter(Boolean);
  if (reads.length) parts.push(`${reads.join(", ")} read`);
  if (summary.commentsRefused) parts.push("comments refused");
  if (summary.followerChecks) parts.push(`followers: ${summary.followerChecks} read, ${summary.followerChanges} changed`);
  if (summary.engagementChanges) parts.push(plural(summary.engagementChanges, "jump"));
  if (summary.securityCheck) parts.push("captcha");
  else if (summary.rateLimited) parts.push("rate-limited");
  else if (summary.blocked) parts.push("refused");
  if (summary.stopped) parts.push("stopped");
  const who = summary.handle ? ` @${summary.handle}` : "";
  return `${time(at)}  pass${who}: ${parts.join("; ") || "nothing read"}${summary.notes.length ? `\n        ${summary.notes.join("\n        ")}` : ""}`;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const command = positionals[0] ?? "";
  if (values.help || !["run", "once", "state"].includes(command)) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  const profile = values.profile?.trim();
  if (!profile && !(command === "state" && values.state)) throw new Error("--profile is required");
  const statePath = values.state ?? defaultStatePath(profile ?? "");
  let state: MonitorState = withSettings(await loadState(statePath), settingsFromFlags(values));
  if (command === "state") {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  }

  const format = values.format ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") throw new Error(`--format: "${format}" is neither json nor text`);
  const intervalMs = values.interval !== undefined ? parseDuration(values.interval, "--interval") : DEFAULT_INTERVAL_MS;
  const print = (line: string) => process.stdout.write(`${line}\n`);
  const log = values.verbose ? (entry: LogEntry) => process.stderr.write(`${JSON.stringify(entry)}\n`) : undefined;
  const browser = nbcBrowser({
    profile: profile!,
    ...(values.nbc ? { binary: values.nbc } : {}),
    ...(values["runtime-root"] ? { runtimeRoot: values["runtime-root"] } : {}),
    ...(values.runtime ? { runtime: values.runtime } : {}),
    ...(values.verbose ? { trace: (entry) => process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ev: "nbc", ...entry })}\n`) } : {}),
  });

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await saveState(statePath, state);
  const wait = (delay: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = undefined;
    });

  for (;;) {
    if (!values["no-start"]) {
      try {
        await browser.start();
      } catch (error) {
        if (command === "once") throw error;
        const message = error instanceof Error ? error.message : String(error);
        const at = Date.now();
        print(format === "json" ? JSON.stringify({ type: "error", at, error: message }) : `${time(at)}  the profile did not start: ${message}`);
        await wait(scheduleDelay(intervalMs));
        if (stopping) return 0;
        continue;
      }
    }
    const result = await runPass({
      browser,
      state,
      ...(log ? { log } : {}),
      shouldStop: () => stopping,
      onEvent: (event) => print(format === "json" ? JSON.stringify(event) : describeEvent(event)),
    });
    state = result.state;
    await saveState(statePath, state);
    const at = state.lastPass?.at ?? Date.now();
    print(format === "json" ? JSON.stringify({ type: "pass", at, summary: result.summary }) : describePass(result.summary, at));
    const backOff = !!result.summary.blocked || result.summary.rateLimited || result.summary.securityCheck;
    if (command === "once" || stopping) return result.summary.securityCheck ? 5 : backOff ? 4 : result.summary.loginRequired ? 3 : 0;
    await wait(scheduleDelay(intervalMs, { backOff }));
    if (stopping) return 0;
  }
}
