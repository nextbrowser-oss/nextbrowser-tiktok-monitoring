// Page scripts: every read the monitor makes on tiktok.com.
//
// tiktok.com renders each page on its server and ships the data it drew the
// page from in one JSON block, <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">,
// keyed by page under "__DEFAULT_SCOPE__": "webapp.app-context" names the
// signed-in account on every page, "webapp.user-detail" holds a creator's
// profile and counts, "webapp.video-detail" a video and its counts. The
// monitor reads that block, from the page the tab shows or from a page it
// fetches, rather than the API calls the web app makes afterwards: those calls
// carry signatures (msToken, X-Bogus) that TikTok's own scripts compute, and
// the monitor does not forge them.
//
// Two things are not in the block. A creator's videos are drawn into the grid
// by the web app after the page loads, so they are read from the grid
// ([data-e2e="user-post-item"]) once it is there. A video's comments exist only
// as a call to /api/comment/list/, which the monitor makes plainly and which
// TikTok may refuse without its signature; see commentsScript.
//
// None of this is a public API. The block's layout and the data-e2e
// attributes are what tiktok.com's web app is known to serve, they change
// without notice, and they have not been verified from a live session for
// this package yet. Every script therefore reports what came back — data, a
// captcha, a rate limit, a page without data — rather than assume.
//
// Each script is one expression returning a JSON-serializable value, run
// through CDP Runtime.evaluate with returnByValue and awaitPromise. Values from
// outside the page are inserted as JSON literals. Answers are cut down in the
// page to the fields the monitor uses.

import { videoId } from "./ids.js";

/** jsLiteral renders a value as a JavaScript literal safe to inline. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? "");
}

/** Where the tab lands before it reads anything: the lightest page on the
 *  same origin as everything else, with none of the web app's scripts. */
export const LANDING_URL = "https://www.tiktok.com/robots.txt";
/** Where a person signs in. It is a real page, because that is what someone
 *  about to sign in wants in front of them; its "Log in" button is there. */
export const SIGN_IN_URL = "https://www.tiktok.com/";

/** What TikTok draws when it wants a person to prove they are one: the slider
 *  or rotate puzzle's container, in either of the two spellings it has used. */
export const CAPTCHA_SELECTOR = "#captcha-verify-container, .captcha_verify_container";
/** One video on a creator's grid. */
export const GRID_ITEM_SELECTOR = '[data-e2e="user-post-item"]';

/** The statusCode webapp.user-detail carries for a creator that does not
 *  exist (10202: no such user; 10221: banned or deleted). */
export const NOT_FOUND_CODES: readonly number[] = [10202, 10221];
/** The statusCode for a private account. */
export const PRIVATE_CODE = 10222;

const FETCH_TIMEOUT_MS = 20_000;
/** How much of a description or a comment is kept. */
export const TEXT_MAX = 2_000;

/** What one request came back with, whatever it was. */
export interface FetchMeta {
  path: string;
  /** The HTTP status; 0 when the request never got an answer. */
  status: number;
  /** An answer with a 2xx status that is neither a captcha nor a limit. */
  ok: boolean;
  /** Set when tiktok.com answered with something other than what was asked
   *  for: the page's title or the start of its text. */
  refused: string;
  /** The request failed before an answer: a network error or the timeout. */
  error: string;
  /** TikTok's own message on a failure (status_msg), as it wrote it. */
  reason: string;
  /** TikTok answered with its captcha instead. */
  captcha: boolean;
  /** TikTok is limiting the profile: HTTP 429, or a "too many requests"
   *  answer. */
  throttled: boolean;
}

export interface RawUser {
  uid: string;
  unique_id: string;
  nickname: string;
}

/** One video as the grid draws it. */
export interface RawGridVideo {
  id: string;
  /** The handle in the video's link. */
  author: string;
  /** The grid marks pinned videos with a badge. */
  pinned: boolean;
  /** The view count printed on the cover, as printed: "12.3K". */
  views_text: string;
  /** The cover's alt text, which TikTok fills with the description. */
  alt: string;
}

/** One video as its own page describes it. */
export interface RawVideo {
  id: string;
  author: string;
  desc: string;
  /** Seconds since the epoch. */
  create_time: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface RawComment {
  cid: string;
  text: string;
  /** Seconds since the epoch. */
  create_time: number | null;
  likes: number | null;
  /** Replies in its thread. */
  replies: number | null;
  /** The commenter's handle. */
  user: string;
  nickname: string;
}

/** Where the tab is, and whether tiktok.com is showing its captcha or its
 *  sign-in page instead of what was asked for. */
export interface OriginSnapshot {
  url: string;
  on_tiktok: boolean;
  login_page: boolean;
  captcha_page: boolean;
}

export interface MeSnapshot extends FetchMeta {
  /** The page carried webapp.app-context, so the answer below means
   *  something: without it nobody can tell signed in from signed out. */
  has_data: boolean;
  signed_in: boolean;
  user: RawUser | null;
}

/** Whether a creator page has drawn enough to be read. */
export interface ReadySnapshot {
  ready: boolean;
  captcha: boolean;
  /** Videos on the grid so far. */
  items: number;
}

export interface ProfileSnapshot {
  url: string;
  captcha: boolean;
  /** The page carried webapp.user-detail. */
  has_data: boolean;
  /** webapp.user-detail's statusCode: 0 for a profile, NOT_FOUND_CODES,
   *  PRIVATE_CODE, or another refusal. */
  status_code: number | null;
  /** The profile exists: its data says so, or, without data, its grid does. */
  found: boolean;
  private: boolean;
  user: { id: string; unique_id: string; nickname: string } | null;
  followers: number | null;
  following: number | null;
  /** Likes on all of the creator's videos. */
  hearts: number | null;
  video_count: number | null;
  videos: RawGridVideo[];
}

export interface VideoSnapshot extends FetchMeta {
  /** The page carried webapp.video-detail. */
  has_data: boolean;
  status_code: number | null;
  video: RawVideo | null;
}

export interface CommentsSnapshot extends FetchMeta {
  /** TikTok did not answer the plain call with comments — an empty answer, a
   *  page, or a non-zero status_code — which is how it treats a call without
   *  its signature. */
  unsigned: boolean;
  comments: RawComment[];
  /** The video's comment count, as the list reports it. */
  total: number | null;
}

/** Helpers every script shares. Ids of 16 digits or more are quoted before
 *  JSON.parse, which would otherwise round them: a video id like
 *  7423156789012345678 does not survive a trip through a Number. TikTok sends
 *  most ids as strings already; the ones it does not are caught here. */
const PAGE_HELPER = String.raw`
  const str = (value, max) => (typeof value === "string" ? value.slice(0, max || 200) : typeof value === "number" && isFinite(value) ? String(value) : "");
  const num = (value) => (typeof value === "number" && isFinite(value) ? value : typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : null);
  const idOf = (value) => { const text = str(value, 40); return /^\d+$/.test(text) ? text : ""; };
  const quoteIds = (text) => text.replace(/("(?:id|uid|cid|aweme_id|authorId|item_id|user_id|reply_id|reply_to_reply_id|group_id|roomId)"\s*:\s*)(\d{16,})/g, '$1"$2"');
  const parseJson = (text) => { try { return JSON.parse(quoteIds(String(text || ""))); } catch (error) { return null; } };
  const rehydrated = (doc) => {
    const box = doc && doc.getElementById ? doc.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__") : null;
    const data = box ? parseJson(box.textContent) : null;
    const scope = data && typeof data === "object" ? data.__DEFAULT_SCOPE__ : null;
    return scope && typeof scope === "object" ? scope : null;
  };
  const visible = (doc) => {
    const parts = [];
    const walk = (node) => {
      const children = node && node.childNodes ? Array.from(node.childNodes) : [];
      for (const child of children) {
        if (parts.length > 2000) return;
        if (child.nodeType === 3) parts.push(child.nodeValue || "");
        else if (child.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(child.nodeName)) walk(child);
      }
    };
    walk(doc && doc.body);
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
  };
  const captchaIn = (doc, hasData) => {
    if (doc && doc.querySelector && doc.querySelector(${jsLiteral(CAPTCHA_SELECTOR)})) return true;
    if (hasData) return false;
    const title = String((doc && doc.title) || "");
    return /verify to continue/i.test(title + " " + visible(doc));
  };
  const captchaUrl = () => /\/(verify|captcha)\b|[?&]captcha/i.test(String(location.pathname || "") + String(location.search || ""));`;

/** request() fetches one path from the current origin and never throws:
 *  every outcome is a value the engine can reason about. readPage() reads an
 *  HTML answer down to its data block. */
const REQUEST_HELPER = String.raw`
  const request = async (path, wants) => {
    const meta = { path: path, status: 0, ok: false, refused: "", error: "", reason: "", captcha: false, throttled: false };
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ${FETCH_TIMEOUT_MS}) : null;
    const accept = wants === "json" ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml";
    let response;
    try {
      response = await fetch(path, { credentials: "include", headers: { accept: accept }, signal: controller ? controller.signal : undefined });
    } catch (error) {
      meta.error = String((error && (error.name === "AbortError" ? "timed out" : error.message)) || error).slice(0, 200);
      return { meta: meta, text: "", url: "" };
    } finally {
      if (timer) clearTimeout(timer);
    }
    meta.status = Number(response.status) || 0;
    const url = String(response.url || "");
    let text = "";
    try { text = await response.text(); } catch (error) { meta.error = "the answer could not be read"; return { meta: meta, text: "", url: url }; }
    if (meta.status === 429) meta.throttled = true;
    if (/\/(verify|captcha)\b|[?&]captcha/i.test(url.replace(/^https?:\/\/[^/]+/i, ""))) meta.captcha = true;
    meta.ok = meta.status >= 200 && meta.status < 300 && !meta.throttled && !meta.captcha;
    return { meta: meta, text: text, url: url };
  };
  const readPage = (got) => {
    if (!got.text) {
      if (!got.meta.error) got.meta.refused = "an empty answer (HTTP " + got.meta.status + ")";
      return null;
    }
    const doc = new DOMParser().parseFromString(got.text, "text/html");
    const scope = rehydrated(doc);
    if (captchaIn(doc, !!scope)) { got.meta.captcha = true; got.meta.ok = false; }
    if (!scope && !got.meta.captcha) {
      got.meta.refused = (String(doc.title || "").trim() || visible(doc) || ("HTTP " + got.meta.status)).slice(0, 160);
    }
    return scope;
  };`;

/** originScript says whether the tab is on tiktok.com, and whether it shows
 *  the captcha or the sign-in page instead of what was asked for. */
export function originScript(): string {
  return String.raw`(() => {${PAGE_HELPER}
  const host = String(location.hostname || "").toLowerCase();
  const onTiktok = host === "tiktok.com" || host.endsWith(".tiktok.com");
  return {
    url: location.href,
    on_tiktok: onTiktok,
    login_page: onTiktok && String(location.pathname || "").indexOf("/login") === 0,
    captcha_page: onTiktok && (captchaUrl() || captchaIn(document, !!rehydrated(document)))
  };
})()`;
}

/** meScript reads who is signed in, from webapp.app-context. With `live` it
 *  reads the page the tab shows (checkAccount has just opened the home page);
 *  otherwise it fetches the home page's HTML, which is the same block every
 *  page carries, without navigating the tab. */
export function meScript(live = false): string {
  return String.raw`(async () => {${PAGE_HELPER}${REQUEST_HELPER}
  let meta;
  let scope;
  if (${jsLiteral(live)}) {
    meta = { path: String(location.pathname || "/"), status: 200, ok: true, refused: "", error: "", reason: "", captcha: false, throttled: false };
    scope = rehydrated(document);
    if (captchaIn(document, !!scope)) { meta.captcha = true; meta.ok = false; }
  } else {
    const got = await request("/", "html");
    meta = got.meta;
    scope = readPage(got);
  }
  const context = scope && scope["webapp.app-context"] && typeof scope["webapp.app-context"] === "object" ? scope["webapp.app-context"] : null;
  const out = Object.assign({ has_data: !!context, signed_in: false, user: null }, meta);
  const u = context && context.user && typeof context.user === "object" ? context.user : null;
  const name = u ? str(u.uniqueId || u.unique_id, 40) : "";
  if (name) {
    out.signed_in = true;
    out.user = { uid: idOf(u.uid || u.id), unique_id: name, nickname: str(u.nickName || u.nickname, 80) };
  }
  return out;
})()`;
}

/** readyScript says whether a creator page has drawn what the monitor reads:
 *  the grid, or a state in which no grid will come — a missing or private
 *  account, a creator with no videos, or the captcha. The data block is in
 *  the HTML from the start; the grid is drawn by the web app after it. */
export function readyScript(): string {
  return String.raw`(() => {${PAGE_HELPER}
  const items = document.querySelectorAll(${jsLiteral(GRID_ITEM_SELECTOR)}).length;
  const scope = rehydrated(document);
  const detail = scope && scope["webapp.user-detail"] && typeof scope["webapp.user-detail"] === "object" ? scope["webapp.user-detail"] : null;
  const status = detail ? num(detail.statusCode) : null;
  const info = detail && detail.userInfo && typeof detail.userInfo === "object" ? detail.userInfo : {};
  const stats = Object.assign({}, info.statsV2 || {}, info.stats || {});
  const captcha = captchaUrl() || captchaIn(document, !!scope);
  const settled = (status !== null && status !== 0) || !!(info.user && info.user.privateAccount === true) || num(stats.videoCount) === 0;
  return { ready: captcha || items > 0 || settled, captcha: captcha, items: items };
})()`;
}

/** profileScript reads the creator page the tab shows: who the creator is and
 *  their counts from webapp.user-detail, and the videos the grid has drawn.
 *  Without the data block a drawn grid still says the profile exists. */
export function profileScript(): string {
  return String.raw`(() => {${PAGE_HELPER}
  const scope = rehydrated(document);
  const detail = scope && scope["webapp.user-detail"] && typeof scope["webapp.user-detail"] === "object" ? scope["webapp.user-detail"] : null;
  const info = detail && detail.userInfo && typeof detail.userInfo === "object" ? detail.userInfo : {};
  const u = info.user && typeof info.user === "object" ? info.user : null;
  const stats = Object.assign({}, info.statsV2 || {}, info.stats || {});
  const status = detail ? num(detail.statusCode) : null;
  const videos = [];
  for (const item of Array.from(document.querySelectorAll(${jsLiteral(GRID_ITEM_SELECTOR)}))) {
    const link = item.querySelector('a[href*="/video/"]');
    const match = /\/@([^/?#]+)\/video\/(\d+)/.exec(link ? String(link.getAttribute("href") || "") : "");
    if (!match || videos.some((video) => video.id === match[2])) continue;
    const views = item.querySelector('[data-e2e="video-views"]');
    const cover = item.querySelector("img[alt]");
    let author = match[1];
    try { author = decodeURIComponent(author); } catch (error) { /* keep it as written */ }
    videos.push({
      id: match[2],
      author: author.slice(0, 40),
      pinned: !!item.querySelector('[data-e2e="video-card-badge"]'),
      views_text: String((views && views.textContent) || "").trim().slice(0, 20),
      alt: str(cover && cover.getAttribute("alt"), ${TEXT_MAX})
    });
  }
  const isPrivate = !!(u && u.privateAccount === true) || status === ${PRIVATE_CODE};
  return {
    url: location.href,
    captcha: captchaUrl() || captchaIn(document, !!scope),
    has_data: !!detail,
    status_code: status,
    found: (!!u && (status === 0 || status === ${PRIVATE_CODE})) || (!detail && videos.length > 0),
    private: isPrivate,
    user: u ? { id: idOf(u.id), unique_id: str(u.uniqueId, 40), nickname: str(u.nickname, 80) } : null,
    followers: num(stats.followerCount),
    following: num(stats.followingCount),
    hearts: num(stats.heartCount !== undefined ? stats.heartCount : stats.heart),
    video_count: num(stats.videoCount),
    videos: videos
  };
})()`;
}

/** videoScript fetches one video's page and reads webapp.video-detail: the
 *  description, when it was posted, and its exact counts. TikTok has sent the
 *  counts both as numbers ("stats") and as digit strings ("statsV2"); either
 *  is read. */
export function videoScript(handle: string, id: string): string {
  return String.raw`(async () => {${PAGE_HELPER}${REQUEST_HELPER}
  const got = await request(${jsLiteral(videoPath(handle, id))}, "html");
  const scope = readPage(got);
  const detail = scope && scope["webapp.video-detail"] && typeof scope["webapp.video-detail"] === "object" ? scope["webapp.video-detail"] : null;
  const out = Object.assign({ has_data: !!detail, status_code: detail ? num(detail.statusCode) : null, video: null }, got.meta);
  const item = detail && detail.itemInfo && detail.itemInfo.itemStruct && typeof detail.itemInfo.itemStruct === "object" ? detail.itemInfo.itemStruct : null;
  if (item && idOf(item.id)) {
    const stats = Object.assign({}, item.statsV2 || {}, item.stats || {});
    const author = item.author && typeof item.author === "object" ? item.author : {};
    out.video = {
      id: idOf(item.id),
      author: str(author.uniqueId || author.unique_id, 40),
      desc: str(item.desc, ${TEXT_MAX}),
      create_time: num(item.createTime),
      views: num(stats.playCount),
      likes: num(stats.diggCount),
      comments: num(stats.commentCount),
      shares: num(stats.shareCount),
      saves: num(stats.collectCount)
    };
  } else if (!got.meta.captcha && !got.meta.refused && !got.meta.error) {
    got.meta.refused = "the page carried no video data";
    out.refused = got.meta.refused;
  }
  return out;
})()`;
}

/** commentsScript asks for the first page of a video's comments, the call the
 *  web app makes when its comment panel opens. The web app signs that call;
 *  this one goes out plain, with the profile's cookies. On a page where
 *  TikTok's web app is running (the monitor reads comments from a creator's
 *  page) its own scripts may sign it on the way out; when nothing does,
 *  TikTok is known to answer with nothing at all or with a non-zero
 *  status_code, which the script reports as `unsigned` rather than as a
 *  failure. TikTok orders this list by its own ranking, not by time. */
export function commentsScript(id: string): string {
  return String.raw`(async () => {${PAGE_HELPER}${REQUEST_HELPER}
  const got = await request(${jsLiteral(commentsPath(id))}, "json");
  const out = Object.assign({ unsigned: false, comments: [], total: null }, got.meta);
  if (out.error || out.captcha || out.throttled) return out;
  const body = /^\s*[\[{]/.test(got.text) ? parseJson(got.text) : null;
  if (!body || typeof body !== "object") {
    out.ok = false;
    if (/<html|<!doctype/i.test(got.text)) {
      const doc = new DOMParser().parseFromString(got.text, "text/html");
      if (captchaIn(doc, false)) { out.captcha = true; return out; }
      out.refused = (String(doc.title || "").trim() || visible(doc) || ("HTTP " + out.status)).slice(0, 160);
    } else {
      out.refused = got.text.trim() ? got.text.trim().slice(0, 160) : "an empty answer (HTTP " + out.status + ")";
    }
    out.unsigned = out.status >= 200 && out.status < 300;
    return out;
  }
  const code = num(body.status_code);
  const message = str(body.status_msg, 160);
  if (code !== 0 || !out.ok) {
    out.ok = false;
    out.reason = message || ("status_code " + code);
    if ((code !== null && code >= 10000 && code < 10100) || /too many|too frequent|rate limit/i.test(message)) out.throttled = true;
    else out.unsigned = true;
    return out;
  }
  out.total = num(body.total);
  out.comments = (Array.isArray(body.comments) ? body.comments : []).map((c) => (c && typeof c === "object" ? {
    cid: idOf(c.cid),
    text: str(c.text, ${TEXT_MAX}),
    create_time: num(c.create_time),
    likes: num(c.digg_count),
    replies: num(c.reply_comment_total),
    user: str(c.user && c.user.unique_id, 40),
    nickname: str(c.user && c.user.nickname, 80)
  } : null)).filter((c) => c && c.cid);
  return out;
})()`;
}

// --- paths ------------------------------------------------------------------

export function videoPath(handle: string, id: string): string {
  return `/@${encodeURIComponent(handle)}/video/${videoId(id)}`;
}

/** aid=1988 is the id TikTok's web app sends for itself; count=20 is the page
 *  the comment panel asks for first. */
export function commentsPath(id: string): string {
  return `/api/comment/list/?aweme_id=${videoId(id)}&count=20&cursor=0&aid=1988`;
}

/** Every script with a label, for the tests that make sure each one is at
 *  least a valid expression. */
export function allScripts(): Record<string, string> {
  return {
    origin: originScript(),
    me: meScript(),
    meLive: meScript(true),
    ready: readyScript(),
    profile: profileScript(),
    video: videoScript("tiktok", "7423156789012345678"),
    comments: commentsScript("7423156789012345678"),
  };
}
