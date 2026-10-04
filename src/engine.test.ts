import { beforeEach, describe, expect, it } from "vitest";
import { checkAccount, runPass, type PassDeps, type PassResult } from "./engine.js";
import type { EngagementChangedEvent, MonitorEvent, NewItemEvent } from "./events.js";
import { creatorUrl, videoUrl } from "./ids.js";
import { LANDING_URL, SIGN_IN_URL } from "./scripts.js";
import { emptyState, withSettings, type MonitorSettings, type MonitorState } from "./state.js";
import { FakeTikTok, NOON, comment, video, type FakeVideo } from "./testing/fakeBrowser.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let clock = NOON + 60 * MINUTE;
let tt: FakeTikTok;
let mine: FakeVideo;
let theirs: FakeVideo;
let sleeps: number[];

beforeEach(() => {
  clock = NOON + 60 * MINUTE;
  sleeps = [];
  tt = new FakeTikTok();
  mine = video("acme", 10, "Our new drop is live #acme", { comments: 2 });
  theirs = video("rival", 20, "Summer sale is live", { comments: 4, views: 2000 });
  tt.creators.acme = { followers: 500, videos: [mine] };
  tt.creators.rival = { followers: 9000, videos: [theirs] };
});

function pass(state: MonitorState, extra: Partial<PassDeps> = {}): Promise<PassResult> {
  return runPass({
    browser: tt,
    state,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...extra,
  });
}

function watching(patch: Partial<MonitorSettings> = {}): MonitorState {
  return emptyState({ creators: ["rival"], keywords: ["acme"], ...patch });
}

const types = (events: MonitorEvent[]) => events.map((event) => event.type);
const fresh = (events: MonitorEvent[]) => events.filter((event): event is NewItemEvent => event.type === "new_item");
const texts = (events: MonitorEvent[]) => fresh(events).map((event) => event.item.text);
const jumps = (events: MonitorEvent[]) => events.filter((event): event is EngagementChangedEvent => event.type === "engagement_changed");

/** later moves the clock to the next pass and returns a minute offset from
 *  NOON that lies between the two passes. */
function later(minutes = 30): number {
  const between = Math.floor((clock - NOON) / MINUTE) + 1;
  clock += minutes * MINUTE;
  return between;
}

/** grow adds comments under a video and raises its count, as TikTok shows. */
function grow(target: FakeVideo, ...added: ReturnType<typeof comment>[]): void {
  tt.comments[target.id] = [...added, ...(tt.comments[target.id] ?? [])];
  target.comments = (target.comments ?? 0) + added.length;
}

describe("the first pass", () => {
  it("signs in, records every source as its starting line, and reads no comment list", async () => {
    const { state, events, summary, matches } = await pass(watching());

    expect(types(events)).toEqual(["signed_in"]);
    expect(summary).toMatchObject({ signedIn: true, handle: "acme", newItems: 0, commentReads: 0, videoReads: 2, pageLoads: 2 });
    expect(summary.baselines).toBe(summary.sourcesRead);
    expect(Object.keys(state.sources).sort()).toEqual(["comments:own", "creator:rival:comments", "creator:rival:videos"]);
    // The videos are watched from here on, at the counts they have now.
    expect(state.videos[mine.id]).toMatchObject({ handle: "acme", comments: 2, commentsRead: 2, views: 500 });
    expect(state.videos[theirs.id]).toMatchObject({ handle: "rival", comments: 4, commentsRead: 4, views: 2000 });
    expect(state.followers).toMatchObject({ acme: { followers: 500 }, rival: { followers: 9000 } });
    // The dashboard still gets what was found; the account's own video is not news to it.
    expect(matches.map((match) => match.item.text)).toEqual(["Summer sale is live"]);
    expect(tt.opened).toEqual([LANDING_URL, creatorUrl("acme"), creatorUrl("rival"), "about:blank"]);
  });

  it("never mutates the state it was given", async () => {
    const given = watching();
    const copy = structuredClone(given);
    const first = await pass(Object.freeze(given));
    expect(given).toEqual(copy);
    const frozen = structuredClone(first.state);
    later();
    grow(mine, comment("buyer", 70, "hi"));
    await pass(Object.freeze(first.state));
    expect(first.state).toEqual(frozen);
  });

  it("paces itself: a few seconds before each page, a little less before each fetch", async () => {
    await pass(watching());
    expect(new Set(sleeps)).toEqual(new Set([5000, 2750]));
  });
});

describe("watched creators", () => {
  it("announces a creator's new video, and ranks one that mentions the account high", async () => {
    const first = await pass(watching());
    const minute = later();
    const launch = video("rival", minute, "Big launch today");
    const shoutout = video("rival", minute + 1, "Thanks @acme for the collab!");
    tt.creators.rival!.videos = [shoutout, launch, theirs];
    const { events } = await pass(first.state);

    expect(texts(events)).toEqual(["Big launch today", "Thanks @acme for the collab!"]);
    expect(fresh(events)[0]).toMatchObject({ source: { kind: "creator_videos", name: "@rival" }, item: { kind: "video", url: videoUrl("rival", launch.id) }, triage: { urgency: "low" } });
    expect(fresh(events)[1]).toMatchObject({ item: { addressed: "mention" }, triage: { urgency: "high", reasons: ["Mentions you"] } });
  });

  it("reports comments under a creator's video only when they name a keyword or the account", async () => {
    const first = await pass(watching({ excludeKeywords: ["giveaway"] }));
    const minute = later();
    grow(theirs,
      comment("shopper", minute, "acme does this cheaper, anyone tried?"),
      comment("fan", minute, "love it"),
      comment("x", minute, "hey @acme you should do this too"),
      comment("bot", minute, "acme giveaway click here"));
    const { events } = await pass(first.state);

    expect(tt.listsRead).toEqual([theirs.id]);
    expect(texts(events).sort()).toEqual(["acme does this cheaper, anyone tried?", "hey @acme you should do this too"]);
    const keyword = fresh(events).find((event) => event.keywords.length > 0)!;
    expect(keyword).toMatchObject({ source: { kind: "creator_comments", name: "@rival" }, keywords: ["acme"], triage: { urgency: "low", reasons: ["Asks a question"] } });
    expect(keyword.item.url).toBe(videoUrl("rival", theirs.id));
    const mention = fresh(events).find((event) => event.item.addressed)!;
    expect(mention).toMatchObject({ item: { addressed: "mention" }, triage: { urgency: "high" } });
  });

  it("says when a creator is private, missing, drew nothing, or drew no grid", async () => {
    tt.creators.locked = { followers: 1, videos: [video("locked", 1, "hidden")], private: true };
    tt.creators.slowpoke = { followers: 2, videos: [video("slowpoke", 1, "x")], blank: true };
    tt.creators.gridless = { followers: 3, videos: [video("gridless", 1, "y")], noGrid: true };
    const { summary, state } = await pass(watching({ creators: ["locked", "nobody_here", "slowpoke", "gridless"] }));
    expect(summary.notes).toEqual(expect.arrayContaining([
      "@locked is private: only the followers it approves see its videos.",
      "@nobody_here was not found on TikTok: check the spelling.",
      "TikTok drew nothing for @slowpoke (a slow page, a sign-in prompt or a captcha); it is read again next pass.",
      "TikTok drew no video grid for @gridless (captcha, login prompt or a slow page); videos are read next pass.",
    ]));
    // Followers still come from the profile's data when the grid did not draw.
    expect(state.followers.gridless).toMatchObject({ followers: 3 });
    expect(state.sources["creator:gridless:videos"]).toBeUndefined();
  });

  it("falls back to the grid when a video's page serves no data", async () => {
    const first = await pass(watching());
    const minute = later();
    const teaser = video("rival", minute, "Teaser", { noDetail: true, views: 12_300 });
    tt.creators.rival!.videos = [teaser, theirs];
    const { events, summary, state } = await pass(first.state);

    const [item] = fresh(events);
    expect(item!.item).toMatchObject({ kind: "video", text: "Teaser created by rival", views: 12_300, partial: true, createdAt: teaser.create_time! * 1000 });
    expect(summary).toMatchObject({ videoReads: 3, partialVideos: 1 });
    expect(summary.notes).toContain("TikTok served no data for 1 video page; their counts are the grid's rounded views until a later pass reads them.");
    expect(state.videos[teaser.id]).toMatchObject({ views: 12_300, approximate: true });
    expect(state.videos[teaser.id]!.commentsRead).toBeUndefined();
  });

  it("reads no comments under a creator's videos with neither keywords nor a signed-in account", async () => {
    tt.signedIn = false;
    const first = await pass(watching({ keywords: [] }));
    later();
    grow(theirs, comment("x", 70, "acme"));
    await pass(first.state);
    expect(tt.listsRead).toEqual([]);
  });
});

describe("comments on the account's videos", () => {
  it("reads a list only when the count grew, announces what is new once, and never again", async () => {
    const first = await pass(watching());
    const minute = later();
    grow(mine, comment("buyer", minute, "Does it ship to Canada?"), comment("acme", minute + 1, "thanks all!"));
    const second = await pass(first.state);

    expect(tt.listsRead).toEqual([mine.id]);
    expect(second.summary.commentReads).toBe(1);
    expect(fresh(second.events)).toHaveLength(1);
    expect(fresh(second.events)[0]).toMatchObject({
      source: { kind: "own_comments", name: "your videos" },
      item: { author: "buyer", kind: "comment", addressed: "comment_on_video", url: videoUrl("acme", mine.id), video: { id: mine.id, author: "acme" } },
      triage: { urgency: "high", reasons: ["Comments on your video", "Asks a question", "No reply yet"] },
    });
    expect(second.state.videos[mine.id]!.commentsRead).toBe(4);

    later();
    const third = await pass(second.state);
    expect(tt.listsRead).toEqual([mine.id]);
    expect(fresh(third.events)).toHaveLength(0);
  });

  it("calls a comment that opens with @account a reply", async () => {
    const first = await pass(watching());
    const minute = later();
    grow(mine, comment("fan", minute, "@acme agreed, the refund came through"));
    const { events } = await pass(first.state);
    expect(fresh(events)[0]).toMatchObject({ item: { addressed: "reply" }, triage: { urgency: "high", reasons: ["Replies to you", 'Says "refund"'] } });
  });

  it("reads every comment of a video posted after monitoring started", async () => {
    const first = await pass(watching());
    const minute = later();
    const restock = video("acme", minute, "Restock!");
    tt.creators.acme!.videos = [restock, mine];
    grow(restock, comment("buyer", minute + 2, "finally"));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["finally"]);
  });

  it("reads no more lists than allowed, and catches up on the next pass", async () => {
    const older = video("acme", 5, "Older drop", { comments: 1 });
    tt.creators.acme!.videos = [mine, older];
    const first = await pass(watching({ maxCommentReads: 1, creators: [] }));
    let minute = later();
    grow(mine, comment("a", minute, "one"));
    grow(older, comment("b", minute, "two"));
    const middle = await pass(first.state);
    expect(texts(middle.events)).toEqual(["one"]);
    expect(middle.summary).toMatchObject({ commentReads: 1, commentReadsDeferred: 1 });
    expect(middle.summary.notes).toContain("1 video with new comments waits for the next pass (maxCommentReads).");
    minute = later();
    const last = await pass(middle.state);
    expect(texts(last.events)).toEqual(["two"]);
  });

  it("skips comments with a note when TikTok refuses the unsigned list, and tries again later", async () => {
    const older = video("acme", 5, "Older drop", { comments: 1 });
    tt.creators.acme!.videos = [mine, older];
    const first = await pass(watching());
    const minute = later();
    grow(mine, comment("buyer", minute, "is this back in stock?"));
    grow(older, comment("buyer2", minute, "price?"));
    tt.unsigned = true;
    const refused = await pass(first.state);

    expect(fresh(refused.events)).toHaveLength(0);
    expect(refused.summary.commentsRefused).toBe(true);
    // One refusal is enough: the second list is not asked for this pass.
    expect(tt.listsRead).toEqual([mine.id]);
    expect(refused.summary.notes).toContain("TikTok did not answer the comment list without its own signature; comments were skipped this pass (see troubleshooting).");
    expect(refused.state.videos[mine.id]!.commentsRead).toBe(2);
    expect(refused.state.videos[older.id]!.commentsRead).toBe(1);

    tt.unsigned = false;
    later();
    const back = await pass(refused.state);
    expect(texts(back.events).sort()).toEqual(["is this back in stock?", "price?"]);
  });

  it("treats an empty first page for a video with comments as the same refusal", async () => {
    const first = await pass(watching());
    later();
    mine.comments = 5;
    const { summary, state } = await pass(first.state);
    expect(summary.commentsRefused).toBe(true);
    expect(state.videos[mine.id]!.commentsRead).toBe(2);
  });
});

describe("engagement", () => {
  it("reports a video whose views and likes jumped, and ranks it as picking up fast", async () => {
    const first = await pass(watching());
    theirs.views = 30_000;
    theirs.likes = 600;
    later();
    const { events, matches, summary, state } = await pass(first.state);

    expect(jumps(events).map((event) => [event.metric, event.previous, event.current, event.delta])).toEqual([
      ["views", 2000, 30_000, 28_000],
      ["likes", 40, 600, 560],
    ]);
    expect(jumps(events)[0]).toMatchObject({ key: `video:${theirs.id}`, handle: "rival", own: false, url: videoUrl("rival", theirs.id) });
    expect(summary.engagementChanges).toBe(2);
    const match = matches.find((entry) => entry.item.id === theirs.id)!;
    expect(match.triage.reasons).toEqual(["Picking up fast: +28K views since the last look"]);
    expect(state.videos[theirs.id]!.history.map((sample) => sample.value)).toEqual([2000, 30_000]);
  });

  it("leaves a small or slow change alone", async () => {
    const first = await pass(watching());
    theirs.views = 2900;
    later();
    expect(jumps((await pass(first.state)).events)).toEqual([]);
  });

  it("reports a jump in comments on the account's own video", async () => {
    const first = await pass(watching({ watchComments: false }));
    mine.comments = 40;
    later();
    const { events } = await pass(first.state);
    expect(jumps(events)).toEqual([expect.objectContaining({ metric: "comments", own: true, previous: 2, current: 40, delta: 38 })]);
  });

  it("follows the thresholds in the settings", async () => {
    const first = await pass(withSettings(watching(), { engagement: { viewsMin: 50_000 } }));
    expect(first.state.settings.engagement).toMatchObject({ viewsMin: 50_000, viewsRatio: 0.5 });
    theirs.views = 30_000;
    later();
    expect(jumps((await pass(first.state)).events).map((event) => event.metric)).toEqual([]);
  });

  it("reports a follower count that moved", async () => {
    const first = await pass(watching());
    tt.creators.rival!.followers = 9100;
    later();
    const { events } = await pass(first.state);
    expect(events).toContainEqual(expect.objectContaining({ type: "followers_changed", handle: "rival", own: false, previous: 9000, current: 9100, delta: 100 }));
  });
});

describe("degraded states", () => {
  it("goes on signed out: says so once, reads public creators, and picks up after a sign-in", async () => {
    const first = await pass(watching());
    tt.signedIn = false;
    const minute = later();
    tt.creators.rival!.videos = [video("rival", minute, "New drop"), theirs];
    const out = await pass(first.state);
    expect(types(out.events)).toEqual(["signed_out", "new_item"]);
    expect(out.summary).toMatchObject({ signedIn: false, loginRequired: true });
    expect(out.summary.notes).toContain("The profile is not signed in to tiktok.com: comments on your videos and mentions of your account wait for a sign-in; public creators are read as usual.");
    expect(tt.opened.filter((url) => url === creatorUrl("acme"))).toHaveLength(1);
    // The account's own source waits for it rather than being forgotten.
    expect(out.state.sources["comments:own"]).toEqual(first.state.sources["comments:own"]);

    later();
    const still = await pass(out.state);
    expect(types(still.events)).toEqual([]);
    tt.signedIn = true;
    later();
    const back = await pass(still.state);
    expect(types(back.events)).toEqual(["signed_in"]);
  });

  it("stops at a captcha on landing and asks for it to be solved by hand", async () => {
    const first = await pass(watching());
    tt.captcha = true;
    later();
    const { events, summary } = await pass(first.state);
    expect(types(events)).toEqual(["security_check"]);
    expect(summary).toMatchObject({ securityCheck: true, requests: 0 });
    expect(summary.blocked).toContain("captcha");
    expect(tt.opened.at(-1)).toBe("about:blank");
  });

  it("stops at a captcha drawn over a creator's page, keeping what was read before it", async () => {
    const first = await pass(watching());
    const minute = later();
    grow(mine, comment("buyer", minute, "where do you ship?"));
    tt.captchaAt = "profile @rival";
    const { events, summary, state } = await pass(first.state);
    expect(types(events)).toEqual(["new_item", "security_check"]);
    expect(summary.securityCheck).toBe(true);
    expect(state.sources["creator:rival:videos"]).toEqual(first.state.sources["creator:rival:videos"]);
  });

  it("stops when TikTok rate-limits the profile, keeping what was read before", async () => {
    const first = await pass(watching());
    const minute = later();
    grow(mine, comment("fan", minute, "@acme love this"));
    tt.throttle = `video ${theirs.id}`;
    const { events, summary, state } = await pass(first.state);
    expect(summary.rateLimited).toBe(true);
    expect(summary.blocked).toContain("HTTP 429");
    expect(fresh(events)).toHaveLength(1);
    expect(state.sources["creator:rival:videos"]).toEqual(first.state.sources["creator:rival:videos"]);
    expect(state.videos[theirs.id]).toEqual(first.state.videos[theirs.id]);
  });

  it("stops when tiktok.com cannot be reached", async () => {
    const first = await pass(watching());
    tt.offline = true;
    later();
    const { summary, state } = await pass(first.state);
    expect(summary.blocked).toBe("tiktok.com could not be reached (Failed to fetch).");
    expect(state.sources).toEqual(first.state.sources);
  });

  it("starts the account's own videos over when another account signs in", async () => {
    const first = await pass(watching());
    tt.handle = "other_brand";
    tt.creators.other_brand = { followers: 3, videos: [] };
    later();
    const { events, state } = await pass(first.state);
    expect(types(events)).toEqual(["account_changed"]);
    expect(state.videos[mine.id]).toBeUndefined();
    expect(state.account).toMatchObject({ handle: "other_brand", signedIn: true });
  });
});

describe("settings", () => {
  it("forgets a creator that was removed, so adding it back starts over", async () => {
    const first = await pass(watching());
    later();
    const without = await pass(withSettings(first.state, { creators: [] }));
    expect(Object.keys(without.state.sources)).toEqual(["comments:own"]);
    expect(without.state.followers.rival).toBeUndefined();
    expect(without.state.videos[theirs.id]).toBeUndefined();
  });

  it("does not announce what is older than the age window after a long absence", async () => {
    const first = await pass(watching({ maxItemAgeMs: 6 * HOUR }));
    const minute = later(20 * 60);
    grow(mine, comment("early", minute + 60, "old news?"), comment("late", minute + 19 * 60, "fresh?"));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["fresh?"]);
  });

  it("says there is nothing to watch", async () => {
    tt.signedIn = false;
    const { summary } = await pass(emptyState());
    expect(summary.notes).toContain("Nothing to watch yet: add creators, or sign the profile in to watch your own videos.");
  });
});

describe("checkAccount", () => {
  it("opens tiktok.com, says who is signed in, and leaves the page open", async () => {
    expect(await checkAccount({ browser: tt })).toEqual({ signedIn: true, handle: "acme" });
    expect(tt.opened).toEqual([SIGN_IN_URL]);
    tt.signedIn = false;
    expect(await checkAccount({ browser: tt })).toEqual({ signedIn: false });
    tt.signedIn = true;
    tt.captcha = true;
    expect(await checkAccount({ browser: tt })).toEqual({ signedIn: false, securityCheck: true });
  });
});
