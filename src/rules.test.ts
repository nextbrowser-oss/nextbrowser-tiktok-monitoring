// The pure rules: ids and links, items, keyword matching, urgency triage, and
// the state document.

import { describe, expect, it } from "vitest";
import { commentUrl, creatorUrl, videoId, videoTime, videoUrl } from "./ids.js";
import { addressedBy, commentItem, mentions, videoContext, videoItem, type VideoFacts } from "./items.js";
import { keywordMatcher } from "./keywords.js";
import { MIN_INTERVAL_MS, scheduleDelay } from "./schedule.js";
import { emptyState, normalizeHandle, normalizeSettings, normalizeState, withSettings } from "./state.js";
import { DEFAULT_URGENT_TERMS, byUrgency, triage } from "./triage.js";
import { NOON, comment, videoIdAt } from "./testing/fakeBrowser.js";

describe("ids", () => {
  it("read when a video was posted from its id, without losing digits", () => {
    const id = videoIdAt(30);
    expect(id.length).toBeGreaterThanOrEqual(19);
    expect(videoTime(id)).toBe(Math.floor((NOON + 30 * 60_000) / 1000) * 1000);
    // 7423156789012345678 >> 32 is 1728338373: 2024-10-07T21:59:33Z.
    expect(new Date(videoTime("7423156789012345678")!).toISOString()).toBe("2024-10-07T21:59:33.000Z");
    expect(videoTime("12345")).toBeUndefined();
    expect(videoTime("not an id")).toBeUndefined();
    expect(videoId("007")).toBe("7");
  });

  it("make the links a person opens; a comment opens at its video", () => {
    expect(creatorUrl("rival")).toBe("https://www.tiktok.com/@rival");
    expect(videoUrl("rival", "7423156789012345678")).toBe("https://www.tiktok.com/@rival/video/7423156789012345678");
    expect(commentUrl("rival", "7423156789012345678")).toBe(videoUrl("rival", "7423156789012345678"));
  });
});

const facts = (patch: Partial<VideoFacts> = {}): VideoFacts => ({
  id: videoIdAt(0), author: "rival", desc: "Summer   sale\nstarts now", views: 1000, likes: 50, comments: 3, partial: false, ...patch,
});

describe("items", () => {
  it("carry the video they are under, for context, and link to it", () => {
    const video = facts();
    const item = commentItem(comment("buyer", 1, "nice"), videoContext(video))!;
    expect(item).toMatchObject({ kind: "comment", author: "buyer", url: videoUrl("rival", video.id), video: { author: "rival", desc: "Summer sale starts now" } });
    expect(item.key).toMatch(/^comment:\d+$/);
    expect(videoItem(video)).toMatchObject({ key: `video:${video.id}`, kind: "video", views: 1000, createdAt: videoTime(video.id) });
  });

  it("mark a video read from the grid alone as partial", () => {
    expect(videoItem(facts({ partial: true, likes: undefined, comments: undefined }))).toMatchObject({ partial: true, views: 1000 });
  });

  it("tell a reply from a mention from a plain comment", () => {
    expect(addressedBy("@acme agreed", "acme", false)).toBe("reply");
    expect(addressedBy("  @ACME agreed", "acme", true)).toBe("reply");
    expect(addressedBy("ask @acme about it", "acme", false)).toBe("mention");
    expect(addressedBy("love it", "acme", true)).toBe("comment_on_video");
    expect(addressedBy("love it", "acme", false)).toBeUndefined();
    expect(addressedBy("love it", "", true)).toBe("comment_on_video");
  });

  it("find a handle only where it is the whole handle", () => {
    expect(mentions("thanks @acme.", "acme")).toBe(true);
    expect(mentions("thanks @acme!", "acme")).toBe(true);
    expect(mentions("thanks @acme_shop", "acme")).toBe(false);
    expect(mentions("thanks @acme.eu", "acme")).toBe(false);
    expect(mentions("mail me at hi@acme.com", "acme")).toBe(false);
    expect(mentions("no handle", "")).toBe(false);
  });
});

describe("keywords", () => {
  it("count a hashtag or a handle as a word", () => {
    const match = keywordMatcher(["acme"]);
    expect(match("loving #acme today")).toEqual(["acme"]);
    expect(match("thanks @acme")).toEqual(["acme"]);
    expect(match("#acmeshop")).toEqual([]);
  });
});

const urgent = keywordMatcher([...DEFAULT_URGENT_TERMS]);
const context = videoContext(facts({ author: "acme" }));

describe("triage", () => {
  it("ranks a question on your video high", () => {
    const item = commentItem(comment("buyer", 50, "Does it ship to Canada?"), context, "comment_on_video")!;
    expect(triage(item, { keywords: [], urgent })).toEqual({ urgency: "high", score: 4, reasons: ["Comments on your video", "Asks a question", "No reply yet"] });
  });

  it("ranks a plain comment on your video medium, and one already answered too", () => {
    const plain = commentItem(comment("fan", 50, "love it"), context, "comment_on_video")!;
    expect(triage(plain, { keywords: [], urgent })).toMatchObject({ urgency: "medium", score: 3 });
    const answered = commentItem(comment("fan", 50, "love it", { replies: 2 }), context, "comment_on_video")!;
    expect(triage(answered, { keywords: [], urgent })).toMatchObject({ urgency: "medium", score: 2 });
  });

  it("ranks a mention and a reply high", () => {
    const mention = commentItem(comment("x", 50, "ask @acme"), context, "mention")!;
    expect(triage(mention, { keywords: [], urgent })).toEqual({ urgency: "high", score: 4, reasons: ["Mentions you"] });
    const reply = commentItem(comment("x", 50, "@acme my order never arrived"), context, "reply")!;
    expect(triage(reply, { keywords: [], urgent })).toEqual({ urgency: "high", score: 7, reasons: ["Replies to you", 'Says "never arrived"'] });
  });

  it("counts an urgent term only in an item about you", () => {
    const stranger = commentItem(comment("x", 50, "my order never arrived"), context)!;
    expect(triage(stranger, { keywords: [], urgent })).toEqual({ urgency: "low", score: 0, reasons: [] });
    expect(triage(stranger, { keywords: ["acme"], urgent })).toEqual({ urgency: "medium", score: 3, reasons: ['Says "never arrived"'] });
  });

  it("ignores the handles a comment starts with when it looks for a question", () => {
    const reply = commentItem(comment("x", 50, "@acme @friend how much?"), context)!;
    expect(triage(reply, { keywords: [], urgent }).reasons).toEqual(["Asks a question"]);
  });

  it("asks no question of a video, and notices one picking up fast", () => {
    const quiet = videoItem(facts({ desc: "how to style it?" }))!;
    expect(triage(quiet, { keywords: [], urgent }).reasons).toEqual([]);
    const busy = videoItem(facts(), undefined, 12_400)!;
    expect(triage(busy, { keywords: [], urgent })).toEqual({ urgency: "low", score: 1, reasons: ["Picking up fast: +12K views since the last look"] });
  });

  it("sorts most urgent first, then newest", () => {
    const entry = (minute: number, urgency: "high" | "low", score: number) => ({
      item: commentItem(comment("a", minute, String(minute)), context)!,
      triage: { urgency, score, reasons: [] },
    });
    expect([entry(1, "low", 0), entry(2, "high", 4), entry(3, "low", 0)].sort(byUrgency).map((e) => e.item.text)).toEqual(["2", "3", "1"]);
  });
});

describe("state", () => {
  it("reads handles in every form a person pastes them", () => {
    for (const value of [
      "rival.studio", "@rival.studio", "https://www.tiktok.com/@rival.studio", "https://www.tiktok.com/@rival.studio?lang=en",
      "https://www.tiktok.com/@rival.studio/video/7423156789012345678", "tiktok.com/@rival.studio", "https://m.tiktok.com/@rival.studio/",
    ]) {
      expect(normalizeHandle(value), value).toBe("rival.studio");
    }
    expect(normalizeHandle("https://vm.tiktok.com/ZMabc123/")).toBe("");
    expect(normalizeHandle("https://www.instagram.com/rival/")).toBe("");
    expect(normalizeHandle("bad..name")).toBe("");
    expect(normalizeHandle("ends.")).toBe("");
    expect(normalizeHandle("not a handle")).toBe("");
  });

  it("clamps settings to safe ranges", () => {
    const settings = normalizeSettings({
      maxCommentReads: 500, ownVideos: -1, videosPerCreator: 99, creators: ["a b", "rival", "RIVAL"],
      engagement: { viewsRatio: 0, viewsMin: 1, likesMin: 5, commentsMin: 0 },
    });
    expect(settings).toMatchObject({ maxCommentReads: 30, ownVideos: 0, videosPerCreator: 10, creators: ["rival"] });
    expect(settings.engagement).toEqual({ viewsRatio: 0.1, viewsMin: 100, likesRatio: 0.5, likesMin: 10, commentsMin: 1 });
    expect(normalizeSettings({ urgentTerms: [] }).urgentTerms).toEqual([]);
    expect(normalizeSettings({}).urgentTerms).toEqual(DEFAULT_URGENT_TERMS);
    expect(normalizeSettings({}).maxItemAgeMs).toBe(72 * 60 * 60 * 1000);
    expect(normalizeSettings({ creators: Array.from({ length: 15 }, (_, index) => `c${index}`) }).creators).toHaveLength(10);
  });

  it("changes one threshold without resetting the others", () => {
    const state = withSettings(emptyState({ engagement: { viewsRatio: 2, viewsMin: 5000, likesRatio: 1, likesMin: 900, commentsMin: 50 } }), { engagement: { commentsMin: 10 } });
    expect(state.settings.engagement).toEqual({ viewsRatio: 2, viewsMin: 5000, likesRatio: 1, likesMin: 900, commentsMin: 10 });
  });

  it("accepts whatever was on disk", () => {
    expect(normalizeState(null)).toEqual(emptyState());
    const state = normalizeState({
      account: { handle: "@acme", uid: "6800000000000000001", signedIn: true, checkedAt: 5 },
      sources: { "comments:own": { since: 1, filter: "" }, broken: {} },
      videos: {
        "7423156789012345678": { handle: "rival", views: 10, commentsRead: 2, checkedAt: 1, history: [{ at: 1, value: 10 }, { at: "x" }] },
        junk: { handle: "rival" },
        "7423156789012345679": { views: 3 },
      },
      seen: ["comment:1", 2],
    });
    expect(state.account).toEqual({ handle: "acme", uid: "6800000000000000001", signedIn: true, checkedAt: 5 });
    expect(Object.keys(state.sources)).toEqual(["comments:own"]);
    expect(state.videos).toEqual({ "7423156789012345678": { handle: "rival", views: 10, commentsRead: 2, checkedAt: 1, history: [{ at: 1, value: 10 }] } });
    expect(state.seen).toEqual(["comment:1"]);
  });
});

describe("scheduleDelay", () => {
  it("spreads the interval, never goes under ten minutes, and backs off after a refusal", () => {
    expect(scheduleDelay(undefined, { random: () => 0.5 })).toBe(30 * 60_000);
    expect(scheduleDelay(60_000, { random: () => 0.5 })).toBe(MIN_INTERVAL_MS);
    expect(MIN_INTERVAL_MS).toBe(10 * 60_000);
    expect(scheduleDelay(30 * 60_000, { random: () => 0.5, backOff: true })).toBe(90 * 60_000);
  });
});
