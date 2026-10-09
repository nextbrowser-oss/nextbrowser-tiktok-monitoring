// @vitest-environment happy-dom
/// <reference lib="dom" />
//
// The page scripts run here against stand-in pages shaped like tiktok.com's
// own: the server-rendered data block (__UNIVERSAL_DATA_FOR_REHYDRATION__)
// with webapp.app-context, webapp.user-detail and webapp.video-detail, a
// creator's grid as the web app draws it, the comment list's JSON, and the
// ways TikTok answers instead — a captcha, a rate limit, a page without data,
// an empty answer to an unsigned call. Most follow the shapes tiktok.com's web
// app is known to serve; the captcha modal and the "Please wait..." answer to
// a fetch of "/" were captured from a live signed-in session on 2026-10-09.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEXT_MAX,
  allScripts,
  commentsPath,
  commentsScript,
  meScript,
  originScript,
  profileScript,
  creatorHereScript,
  readyScript,
  videoPath,
  videoScript,
  type CommentsSnapshot,
  type MeSnapshot,
  type OriginSnapshot,
  type ProfileSnapshot,
  type ReadySnapshot,
  type VideoSnapshot,
} from "./scripts.js";

async function run<T>(script: string): Promise<T> {
  return JSON.parse(JSON.stringify(await (0, eval)(script))) as T;
}

function page(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

const DATA_ID = "__UNIVERSAL_DATA_FOR_REHYDRATION__";

/** dataBlock writes the data block the way tiktok.com does. A string scope is
 *  sent as it is, so a test can send ids JSON cannot hold. */
function dataBlock(scope: unknown): string {
  const json = typeof scope === "string" ? `{"__DEFAULT_SCOPE__":${scope}}` : JSON.stringify({ __DEFAULT_SCOPE__: scope });
  return `<script id="${DATA_ID}" type="application/json">${json}</script>`;
}

function html(body: string, title = "TikTok - Make Your Day"): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

/** show puts a page in the tab: its URL, its body, and its data block. */
function show(url: string, body: string, scope?: unknown): void {
  page(url);
  document.title = "TikTok";
  document.body.innerHTML = body;
  if (scope !== undefined) {
    const box = document.createElement("script");
    box.id = DATA_ID;
    box.type = "application/json";
    box.textContent = typeof scope === "string" ? `{"__DEFAULT_SCOPE__":${scope}}` : JSON.stringify({ __DEFAULT_SCOPE__: scope });
    document.body.appendChild(box);
  }
}

interface Answer {
  status?: number;
  body: string;
  url?: string;
}

function answer(response: Answer) {
  const asked: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    asked.push({ path, init });
    const { status = 200, body, url = `https://www.tiktok.com${path}` } = response;
    return { status, ok: status >= 200 && status < 300, url, text: async () => body };
  });
  return asked;
}

const cell = (handle: string, id: string, views: string, extra = "") => `
  <div data-e2e="user-post-item">${extra}
    <a href="https://www.tiktok.com/@${handle}/video/${id}"><img alt="Summer drop is here #acme created by ${handle}" src="x.jpg"></a>
    <strong data-e2e="video-views">${views}</strong>
  </div>`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("every script", () => {
  it.each(Object.entries(allScripts()))("%s is a single valid expression", (_name, script) => {
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });
});

describe("originScript", () => {
  it("knows tiktok.com, its captcha and its sign-in page", async () => {
    show("https://www.tiktok.com/robots.txt", "User-agent: *");
    expect(await run<OriginSnapshot>(originScript())).toMatchObject({ on_tiktok: true, login_page: false, captcha_page: false });
    show("https://www.tiktok.com/@rival", '<div id="captcha-verify-container">Drag the slider</div>', {});
    expect((await run<OriginSnapshot>(originScript())).captcha_page).toBe(true);
    show("https://www.tiktok.com/verify?type=slide", "");
    expect((await run<OriginSnapshot>(originScript())).captcha_page).toBe(true);
    show("https://www.tiktok.com/login?redirect_url=%2F", "");
    expect((await run<OriginSnapshot>(originScript())).login_page).toBe(true);
    show("https://example.com/", "");
    expect((await run<OriginSnapshot>(originScript())).on_tiktok).toBe(false);
  });

  it("knows the October 2026 captcha modal over a creator page that has its data", async () => {
    // As captured live on 2026-10-09: a TUXModal over @nike's grid.
    show("https://www.tiktok.com/@nike", '<div id=":r1:" class="TUXModal captcha-verify-container"><div id="captcha-verify-container-main-page">Drag the slider to fit the puzzle<button id="captcha_slide_button"></button></div></div>',
      { "webapp.app-context": { user: { uid: "1", uniqueId: "acme" } }, "webapp.user-detail": { statusCode: 0, userInfo: { user: { id: "2", uniqueId: "nike" }, stats: { followerCount: 9300000 } } } });
    expect((await run<OriginSnapshot>(originScript())).captcha_page).toBe(true);
    expect((await run<ProfileSnapshot>(profileScript())).captcha).toBe(true);
  });
});

describe("creatorHereScript", () => {
  const grid = '<div data-e2e="user-post-item"><a href="https://www.tiktok.com/@nike/video/7694398644551748877"></a></div>';
  const about = (handle: string) => ({ "webapp.user-detail": { statusCode: 0, userInfo: { user: { id: "2", uniqueId: handle }, stats: { followerCount: 1 } } } });

  it("reuses the creator page the tab already shows", async () => {
    show("https://www.tiktok.com/@nike", grid, about("nike"));
    expect(await run<{ here: boolean }>(creatorHereScript("Nike"))).toEqual({ here: true });
  });

  it("reloads after an in-app move, whose data block is still the first creator's", async () => {
    show("https://www.tiktok.com/@duolingo", grid, about("nike"));
    expect(await run<{ here: boolean }>(creatorHereScript("duolingo"))).toEqual({ here: false });
  });

  it("reloads a page without its grid or behind a captcha", async () => {
    show("https://www.tiktok.com/@nike", "<main></main>", about("nike"));
    expect((await run<{ here: boolean }>(creatorHereScript("nike"))).here).toBe(false);
    show("https://www.tiktok.com/@nike", grid + '<div class="TUXModal captcha-verify-container"></div>', about("nike"));
    expect((await run<{ here: boolean }>(creatorHereScript("nike"))).here).toBe(false);
  });
});

describe("meScript", () => {
  it("reads the signed-in account from the home page's data block, keeping its id whole", async () => {
    page("https://www.tiktok.com/robots.txt");
    const asked = answer({ body: html(dataBlock(`{"webapp.app-context":{"language":"en","user":{"uid":6800000000000000001,"uniqueId":"acme","nickName":"Acme Co"}}}`)) });
    const me = await run<MeSnapshot>(meScript());
    expect(asked[0]).toMatchObject({ path: "/", init: { credentials: "include" } });
    expect(me).toMatchObject({ ok: true, has_data: true, signed_in: true, user: { uid: "6800000000000000001", unique_id: "acme", nickname: "Acme Co" } });
  });

  it("knows a signed-out page from a page that says nothing", async () => {
    page("https://www.tiktok.com/robots.txt");
    answer({ body: html(dataBlock({ "webapp.app-context": { language: "en", user: {} } })) });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ has_data: true, signed_in: false, user: null });
    answer({ status: 403, body: html("<h1>Access Denied</h1>", "Access Denied") });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ status: 403, has_data: false, signed_in: false, refused: "Access Denied" });
  });

  it("reads a TikTok page already in the tab instead of fetching the \"Please wait...\" page", async () => {
    show("https://www.tiktok.com/foryou", "<main></main>", { "webapp.app-context": { user: { uid: "7", uniqueId: "clartt58", nickName: "clartt58" } } });
    const asked = answer({ body: html("<title>Please wait...</title>", "Please wait...") });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ ok: true, has_data: true, signed_in: true, user: { unique_id: "clartt58" } });
    expect(asked).toHaveLength(0);
  });

  it("reads the page the tab shows when asked to", async () => {
    show("https://www.tiktok.com/", "<main></main>", { "webapp.app-context": { user: { uid: "1", uniqueId: "acme", nickName: "Acme" } } });
    expect(await run<MeSnapshot>(meScript(true))).toMatchObject({ signed_in: true, user: { unique_id: "acme" } });
  });

  it("knows a captcha, a rate limit and a request that never got an answer", async () => {
    page("https://www.tiktok.com/robots.txt");
    answer({ body: html('<div class="captcha_verify_container">Verify to continue:</div>', "Security Check") });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ captcha: true, ok: false });
    answer({ body: html("<p>Verify to continue</p>", "tiktok") });
    expect((await run<MeSnapshot>(meScript())).captcha).toBe(true);
    answer({ status: 429, body: "Too Many Requests" });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ throttled: true, ok: false });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await run<MeSnapshot>(meScript())).toMatchObject({ status: 0, error: "Failed to fetch" });
  });

  it("does not mistake the words of a page that has data for a captcha", async () => {
    page("https://www.tiktok.com/robots.txt");
    answer({ body: html(`<p>Verify to continue is a phrase in this video</p>${dataBlock({ "webapp.app-context": { user: {} } })}`) });
    expect((await run<MeSnapshot>(meScript())).captcha).toBe(false);
  });
});

const PROFILE = `{"webapp.user-detail":{"statusCode":0,"userInfo":{
  "user":{"id":6900000000000000002,"uniqueId":"rival","nickname":"Rival Studio","privateAccount":false},
  "stats":{"followerCount":9000,"followingCount":12,"heartCount":120000,"videoCount":48},
  "statsV2":{"followerCount":"9000","followingCount":"12","heart":"120000","videoCount":"48"}}}}`;

describe("readyScript", () => {
  it("waits for the grid, and not for a page that will never draw one", async () => {
    show("https://www.tiktok.com/@rival", "<main></main>", PROFILE);
    expect(await run<ReadySnapshot>(readyScript())).toEqual({ ready: false, captcha: false, items: 0 });
    show("https://www.tiktok.com/@rival", cell("rival", "7423156789012345678", "1.2K"), PROFILE);
    expect(await run<ReadySnapshot>(readyScript())).toEqual({ ready: true, captcha: false, items: 1 });
    show("https://www.tiktok.com/@nobody", "<main></main>", { "webapp.user-detail": { statusCode: 10221, userInfo: {} } });
    expect((await run<ReadySnapshot>(readyScript())).ready).toBe(true);
    show("https://www.tiktok.com/@new", "<main></main>", { "webapp.user-detail": { statusCode: 0, userInfo: { user: { uniqueId: "new" }, stats: { videoCount: 0 } } } });
    expect((await run<ReadySnapshot>(readyScript())).ready).toBe(true);
    show("https://www.tiktok.com/@rival", '<div id="captcha-verify-container"></div>', PROFILE);
    expect(await run<ReadySnapshot>(readyScript())).toMatchObject({ ready: true, captcha: true });
  });
});

describe("profileScript", () => {
  it("reads the profile's counts from its data and its videos from the grid", async () => {
    show("https://www.tiktok.com/@rival", [
      cell("rival", "7400000000000000001", "1.2M", '<div data-e2e="video-card-badge">Pinned</div>'),
      cell("rival", "7423156789012345678", "12.3K"),
      cell("rival", "7423156789012345678", "12.3K"),
      '<div data-e2e="user-post-item"><a href="/@rival/photo/7423">a photo post</a></div>',
    ].join(""), PROFILE);
    const snapshot = await run<ProfileSnapshot>(profileScript());
    expect(snapshot).toMatchObject({
      captcha: false, has_data: true, status_code: 0, found: true, private: false,
      user: { id: "6900000000000000002", unique_id: "rival", nickname: "Rival Studio" },
      followers: 9000, following: 12, hearts: 120000, video_count: 48,
    });
    expect(snapshot.videos).toEqual([
      { id: "7400000000000000001", author: "rival", pinned: true, views_text: "1.2M", alt: "Summer drop is here #acme created by rival" },
      { id: "7423156789012345678", author: "rival", pinned: false, views_text: "12.3K", alt: "Summer drop is here #acme created by rival" },
    ]);
  });

  it("reads the counts TikTok sent as strings", async () => {
    show("https://www.tiktok.com/@rival", "", `{"webapp.user-detail":{"statusCode":0,"userInfo":{"user":{"id":"1","uniqueId":"rival"},"statsV2":{"followerCount":"1234567","videoCount":"3"}}}}`);
    expect(await run<ProfileSnapshot>(profileScript())).toMatchObject({ followers: 1234567, video_count: 3 });
  });

  it("knows a missing account, a private one, and a grid without data", async () => {
    show("https://www.tiktok.com/@nobody_here", "", { "webapp.user-detail": { statusCode: 10221, userInfo: {} } });
    expect(await run<ProfileSnapshot>(profileScript())).toMatchObject({ found: false, status_code: 10221 });
    show("https://www.tiktok.com/@locked", "", { "webapp.user-detail": { statusCode: 10222, userInfo: { user: { id: "5", uniqueId: "locked", privateAccount: true }, stats: { followerCount: 10, videoCount: 4 } } } });
    expect(await run<ProfileSnapshot>(profileScript())).toMatchObject({ found: true, private: true, followers: 10, videos: [] });
    show("https://www.tiktok.com/@rival", cell("rival", "7423156789012345678", "980"));
    expect(await run<ProfileSnapshot>(profileScript())).toMatchObject({ found: true, has_data: false, followers: null, videos: [{ id: "7423156789012345678", views_text: "980" }] });
    show("https://www.tiktok.com/@rival", "");
    expect(await run<ProfileSnapshot>(profileScript())).toMatchObject({ found: false, has_data: false });
  });
});

describe("videoScript", () => {
  it("fetches a video's page and reads its description, time and exact counts", async () => {
    page("https://www.tiktok.com/@rival");
    const asked = answer({
      body: html(dataBlock(`{"webapp.video-detail":{"statusCode":0,"itemInfo":{"itemStruct":{"id":7423156789012345678,"desc":"Summer drop #acme","createTime":1790935200,
        "author":{"uniqueId":"rival"},"stats":{"playCount":15880,"diggCount":1204,"commentCount":88,"shareCount":12,"collectCount":40}}}}}`)),
    });
    const snapshot = await run<VideoSnapshot>(videoScript("rival", "7423156789012345678"));
    expect(asked[0]!.path).toBe(videoPath("rival", "7423156789012345678"));
    expect(asked[0]!.path).toBe("/@rival/video/7423156789012345678");
    expect(snapshot).toMatchObject({ ok: true, has_data: true, status_code: 0 });
    expect(snapshot.video).toEqual({
      id: "7423156789012345678", author: "rival", desc: "Summer drop #acme", create_time: 1790935200,
      views: 15880, likes: 1204, comments: 88, shares: 12, saves: 40,
    });
  });

  it("reads counts sent as strings, and cuts a long description", async () => {
    page("https://www.tiktok.com/@rival");
    answer({
      body: html(dataBlock({ "webapp.video-detail": { statusCode: 0, itemInfo: { itemStruct: {
        id: "7423156789012345678", desc: "x".repeat(TEXT_MAX + 5), createTime: "1790935200", author: { uniqueId: "rival" },
        statsV2: { playCount: "2500000", diggCount: "1", commentCount: "2", shareCount: "3", collectCount: "4" },
      } } } })),
    });
    const { video } = await run<VideoSnapshot>(videoScript("rival", "7423156789012345678"));
    expect(video).toMatchObject({ views: 2_500_000, create_time: 1790935200 });
    expect(video!.desc).toHaveLength(TEXT_MAX);
  });

  it("reports a page that carried no video data", async () => {
    page("https://www.tiktok.com/@rival");
    answer({ body: html(dataBlock({ "webapp.app-context": { user: {} } })) });
    expect(await run<VideoSnapshot>(videoScript("rival", "1"))).toMatchObject({ has_data: false, video: null, refused: "the page carried no video data" });
    answer({ body: html("<p>Something went wrong</p>", "TikTok") });
    expect(await run<VideoSnapshot>(videoScript("rival", "1"))).toMatchObject({ video: null, refused: "TikTok" });
  });
});

describe("commentsScript", () => {
  it("asks for the first page of comments and keeps their ids whole", async () => {
    page("https://www.tiktok.com/@rival");
    const asked = answer({
      body: `{"status_code":0,"total":89,"cursor":20,"has_more":1,"comments":[{"cid":7423999999999999991,"text":"does it ship to Canada?","create_time":1790935500,
        "digg_count":3,"reply_comment_total":0,"user":{"unique_id":"buyer","nickname":"Buyer"}}]}`,
    });
    const snapshot = await run<CommentsSnapshot>(commentsScript("7423156789012345678"));
    expect(asked[0]).toMatchObject({ path: commentsPath("7423156789012345678"), init: { credentials: "include" } });
    expect(asked[0]!.path).toBe("/api/comment/list/?aweme_id=7423156789012345678&count=20&cursor=0&aid=1988");
    expect(snapshot).toMatchObject({ ok: true, unsigned: false, total: 89, cursor: 20, has_more: true });
    expect(snapshot.comments).toEqual([{ cid: "7423999999999999991", text: "does it ship to Canada?", create_time: 1790935500, likes: 3, replies: 0, user: "buyer", nickname: "Buyer" }]);
  });

  it("asks for a later page by its cursor, and knows the last one", async () => {
    page("https://www.tiktok.com/@rival");
    const asked = answer({ body: `{"status_code":0,"total":45,"cursor":45,"has_more":0,"comments":[]}` });
    const snapshot = await run<CommentsSnapshot>(commentsScript("7423156789012345678", 40));
    expect(asked[0]!.path).toBe("/api/comment/list/?aweme_id=7423156789012345678&count=20&cursor=40&aid=1988");
    expect(snapshot).toMatchObject({ ok: true, cursor: 45, has_more: false, comments: [] });
  });

  it("reports an unsigned call as refused, not failed: an empty answer, a page, or a non-zero status", async () => {
    page("https://www.tiktok.com/@rival");
    answer({ body: "" });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ ok: false, unsigned: true, refused: "an empty answer (HTTP 200)", throttled: false });
    answer({ body: html("<p>Page not available</p>", "TikTok") });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ unsigned: true, refused: "TikTok" });
    answer({ body: `{"status_code":8,"status_msg":"invalid parameters"}` });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ ok: false, unsigned: true, reason: "invalid parameters" });
  });

  it("knows a rate limit and a captcha", async () => {
    page("https://www.tiktok.com/@rival");
    answer({ status: 429, body: "" });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ throttled: true, unsigned: false });
    answer({ body: `{"status_code":10000,"status_msg":"Too many requests, try again later"}` });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ throttled: true, unsigned: false });
    answer({ body: html('<div id="captcha-verify-container"></div>') });
    expect(await run<CommentsSnapshot>(commentsScript("1"))).toMatchObject({ captcha: true, unsigned: false });
  });
});
