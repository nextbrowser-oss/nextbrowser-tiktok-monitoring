import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PassSummary } from "../engine.js";
import { emptyState } from "../state.js";
import { describeEvent, describePass, parseDuration, settingsFromFlags } from "./cli.js";
import { loadState, saveState } from "./store.js";

describe("parseDuration", () => {
  it("reads the durations the flags take", () => {
    expect(parseDuration("30m", "--x")).toBe(1_800_000);
    expect(parseDuration("72h", "--x")).toBe(259_200_000);
    expect(() => parseDuration("soon", "--interval")).toThrow("--interval");
  });
});

describe("settingsFromFlags", () => {
  it("patches only what was given, and the negative flag wins", () => {
    expect(settingsFromFlags({})).toEqual({});
    expect(settingsFromFlags({ "no-own": true, own: true, "no-comments": true, "keep-tab": true })).toEqual({ watchOwnVideos: false, watchComments: false, parkTab: false });
    expect(settingsFromFlags({ creators: "@rival, https://www.tiktok.com/@other.brand", keywords: "acme, #acmedrop", "max-comment-reads": "4", "views-jump": "5000" })).toEqual({
      creators: ["rival", "other.brand"],
      keywords: ["acme", "#acmedrop"],
      maxCommentReads: 4,
      engagement: { viewsMin: 5000 },
    });
  });

  it("refuses a username TikTok would not have", () => {
    expect(() => settingsFromFlags({ creators: "ok, bad..name" })).toThrow("not a TikTok username");
  });
});

describe("describeEvent", () => {
  const at = new Date(2026, 9, 5, 9, 5).getTime();
  const url = "https://www.tiktok.com/@acme/video/7423156789012345678";

  it("writes a match on two lines: who and how urgent, then why and the link", () => {
    const line = describeEvent({
      type: "new_item",
      at,
      source: { kind: "own_comments", name: "your videos" },
      keywords: [],
      triage: { urgency: "high", score: 4, reasons: ["Comments on your video", "Asks a question"] },
      item: { key: "comment:1", id: "1", kind: "comment", author: "buyer", text: "Does it ship to Canada?", url, addressed: "comment_on_video" },
    });
    expect(line).toBe(`09:05  HIGH    @buyer commented on your video: Does it ship to Canada?\n        [Comments on your video · Asks a question]  ${url}`);
  });

  it("names the creator a comment was found under, and a video by what it is", () => {
    const comment = describeEvent({
      type: "new_item",
      at,
      source: { kind: "creator_comments", name: "@rival" },
      keywords: ["acme"],
      triage: { urgency: "low", score: 0, reasons: [] },
      item: { key: "comment:2", id: "2", kind: "comment", author: "shopper", text: "acme is cheaper", url },
    });
    expect(comment).toContain("@shopper commented under @rival's video: acme is cheaper");
    const video = describeEvent({
      type: "new_item",
      at,
      source: { kind: "creator_videos", name: "@rival" },
      keywords: [],
      triage: { urgency: "high", score: 4, reasons: ["Mentions you"] },
      item: { key: "video:3", id: "3", kind: "video", author: "rival", text: "", url, addressed: "mention" },
    });
    expect(video).toContain("@rival mentioned you in a video: [no description]");
    expect(describeEvent({ type: "security_check", at, handle: "acme" })).toContain("open tiktok.com in the profile and solve it");
  });

  it("writes an engagement jump with its link", () => {
    expect(describeEvent({ type: "engagement_changed", at, key: "video:7", videoId: "7", url, handle: "rival", own: false, metric: "views", previous: 2000, current: 30000, delta: 28000 }))
      .toBe(`09:05  views @rival: 2,000 → 30,000 (+28,000)\n        ${url}`);
  });
});

describe("describePass", () => {
  const summary: PassSummary = {
    signedIn: true, handle: "acme", loginRequired: false, securityCheck: false, rateLimited: false, requests: 8, pageLoads: 2, sourcesRead: 3,
    baselines: 0, itemsRead: 40, matches: 6, newItems: 2, urgent: 1, videoReads: 5, partialVideos: 0, commentReads: 2, commentReadsDeferred: 0,
    commentsRefused: false, followerChecks: 2, followerChanges: 1, engagementChanges: 0, stopped: false, notes: [],
  };

  it("sums a pass up in one line", () => {
    expect(describePass(summary, new Date(2026, 9, 5, 21, 5).getTime()))
      .toBe("21:05  pass @acme: 3 sources: 2 new (1 urgent) of 6 matches; 5 videos, 2 comment lists read; followers: 2 read, 1 changed");
  });

  it("says what stopped it", () => {
    const line = describePass({ ...summary, sourcesRead: 0, videoReads: 0, commentReads: 0, followerChecks: 0, securityCheck: true, notes: ["Solve it."] }, new Date(2026, 9, 5, 9, 0).getTime());
    expect(line).toBe("09:00  pass @acme: captcha\n        Solve it.");
  });
});

describe("the state file", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, and refuses a file it cannot read", async () => {
    dir = await mkdtemp(join(tmpdir(), "tiktok-monitor-"));
    const path = join(dir, "nested", "state.json");
    expect(await loadState(path)).toEqual(emptyState());
    const state = { ...emptyState({ creators: ["rival"] }), seen: ["comment:1"] };
    await saveState(path, state);
    expect(await loadState(path)).toEqual(state);
    await writeFile(path, "{ not json");
    await expect(loadState(path)).rejects.toThrow();
  });
});
