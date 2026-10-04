// Renders assets/tiktok-monitor-terminal.svg, the terminal shown at the top of
// the README. Every line comes from the CLI's own formatters
// (dist/node/cli.js), so the picture shows exactly what `tiktok-monitor run`
// prints; the accounts, videos and numbers are sample data.
//
//   npm run build && npm run render:terminal

import { writeFile } from "node:fs/promises";
import { describeEvent, describePass } from "../dist/node/cli.js";

const at = (hour, minute) => new Date(2026, 9, 5, hour, minute).getTime();
const video = (handle, id) => `https://www.tiktok.com/@${handle}/video/${id}`;
const item = (kind, id, author, text, url, extra = {}) => ({ key: `${kind}:${id}`, id, kind, author, text, url, ...extra });
const found = (time, source, value, urgency, reasons, keywords = []) => ({
  type: "new_item", at: time, account: "acme", source, item: value, keywords, triage: { urgency, score: 0, reasons },
});
const pass = (patch) => ({
  signedIn: true, handle: "acme", loginRequired: false, securityCheck: false, rateLimited: false, requests: 0, pageLoads: 2,
  sourcesRead: 3, baselines: 0, itemsRead: 0, matches: 0, newItems: 0, urgent: 0, videoReads: 9, partialVideos: 0,
  commentReads: 0, commentReadsDeferred: 0, commentsRefused: false, followerChecks: 2, followerChanges: 0, engagementChanges: 0,
  stopped: false, notes: [], ...patch,
});

const OWN = "7557812345678901234";
const THEIRS = "7557890123456789012";
const NEW = "7558012345678901234";
const own = { kind: "own_comments", name: "your videos" };
const rival = { kind: "creator_comments", name: "@rivalwear" };

const lines = [
  describeEvent({ type: "signed_in", at: at(9, 0), handle: "acme" }),
  describePass(pass({ baselines: 3, matches: 6 }), at(9, 0)),
  describeEvent(found(at(9, 30), own,
    item("comment", "1", "mila.makes", "does the large one ship to Canada?", video("acme", OWN), { addressed: "comment_on_video", replies: 0 }),
    "high", ["Comments on your video", "Asks a question", "No reply yet"])),
  describeEvent(found(at(9, 30), rival,
    item("comment", "2", "jules.k", "honestly @acme does this better", video("rivalwear", THEIRS), { addressed: "mention" }),
    "high", ["Mentions you"])),
  describeEvent(found(at(9, 30), rival,
    item("comment", "3", "tom_rides", "is this the same as acme? looks identical", video("rivalwear", THEIRS)),
    "low", ["Asks a question"], ["acme"])),
  describeEvent(found(at(9, 30), { kind: "creator_videos", name: "@rivalwear" },
    item("video", NEW, "rivalwear", "Fall drop is live, 30% off this week #fallfits", video("rivalwear", NEW)),
    "low", [])),
  describeEvent({ type: "engagement_changed", at: at(9, 30), key: `video:${THEIRS}`, videoId: THEIRS, url: video("rivalwear", THEIRS), handle: "rivalwear", own: false, metric: "views", previous: 2140, current: 31800, delta: 29660 }),
  describePass(pass({ matches: 9, newItems: 4, urgent: 2, commentReads: 2, engagementChanges: 1 }), at(9, 30)),
  describeEvent({ type: "followers_changed", at: at(10, 0), handle: "acme", own: true, previous: 12480, current: 12517, delta: 37 }),
  describePass(pass({ matches: 9, followerChanges: 1 }), at(10, 0)),
];

const COLORS = {
  background: "#0b1120",
  bar: "#111827",
  border: "#1f2937",
  text: "#e5e7eb",
  dim: "#6b7280",
  prompt: "#2dd4bf",
  high: "#f87171",
  medium: "#fbbf24",
  low: "#94a3b8",
  counts: "#60a5fa",
  pass: "#94a3b8",
  user: "#c4b5fd",
  reasons: "#a7f3d0",
  up: "#34d399",
  down: "#f87171",
  link: "#64748b",
};

const TOKEN = /(\bHIGH\b|\bMEDIUM\b|(?<=^\s{2})low\b|\b(?:followers|views|likes|comments)(?= @)|\bsigned in\b|\bpass(?= @)|@[A-Za-z0-9._]*[A-Za-z0-9_]|https:\/\/\S+|\[[^\]]*\]|\(\+[\d,]+\)|\(-[\d,]+\))/g;

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorOf(token) {
  if (token === "HIGH") return COLORS.high;
  if (token === "MEDIUM") return COLORS.medium;
  if (token === "low") return COLORS.low;
  if (["followers", "views", "likes", "comments", "signed in"].includes(token)) return COLORS.counts;
  if (token === "pass") return COLORS.pass;
  if (token.startsWith("@")) return COLORS.user;
  if (token.startsWith("https://")) return COLORS.link;
  if (token.startsWith("[")) return COLORS.reasons;
  if (token.startsWith("(+")) return COLORS.up;
  if (token.startsWith("(-")) return COLORS.down;
  return COLORS.dim;
}

function spans(line) {
  const time = line.slice(0, 5);
  const rest = line.slice(5);
  const parts = [`<tspan fill="${COLORS.dim}">${escape(time)}</tspan>`];
  let last = 0;
  for (const match of rest.matchAll(TOKEN)) {
    if (match.index > last) parts.push(escape(rest.slice(last, match.index)));
    parts.push(`<tspan fill="${colorOf(match[0])}">${escape(match[0])}</tspan>`);
    last = match.index + match[0].length;
  }
  parts.push(escape(rest.slice(last)));
  return parts.join("");
}

// An event or a pass carries its details on the lines under it.
const rowsText = lines.flatMap((line) => line.split("\n"));
const FONT_SIZE = 14;
const LINE = 26;
const CHAR = FONT_SIZE * 0.6;
const PAD = 28;
const BAR = 40;
const command = "$ tiktok-monitor run --profile acme --creators rivalwear --keywords acme";
const longest = Math.max(command.length, ...rowsText.map((line) => line.length));
const width = Math.ceil(PAD * 2 + longest * CHAR);
const height = BAR + PAD + LINE * (rowsText.length + 1) + PAD - 6;

const rows = [
  `<text x="${PAD}" y="${BAR + PAD + 4}"><tspan fill="${COLORS.prompt}">$</tspan> ${escape(command.slice(2))}</text>`,
  ...rowsText.map((line, index) => `<text x="${PAD}" y="${BAR + PAD + 4 + LINE * (index + 1)}" xml:space="preserve">${spans(line)}</text>`),
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Example tiktok-monitor output: comments on your video, mentions and keyword comments under a creator's video ranked by urgency, a new video, a views jump, and a follower change">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <path d="M12.5 0.5h${width - 25}a12 12 0 0 1 12 12v${BAR - 12}h-${width - 1}v-${BAR - 12}a12 12 0 0 1 12-12z" fill="${COLORS.bar}"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="44" cy="20" r="6" fill="#febc2e"/>
  <circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="25" text-anchor="middle" fill="${COLORS.dim}" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">tiktok-monitor — sample output</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}" fill="${COLORS.text}">
    ${rows.join("\n    ")}
  </g>
</svg>
`;

await writeFile(new URL("../assets/tiktok-monitor-terminal.svg", import.meta.url), svg);
console.log(`assets/tiktok-monitor-terminal.svg: ${width}x${height}, ${rowsText.length} lines`);
for (const line of rowsText) if (line.length > 124) console.log(`long (${line.length}): ${line}`);
