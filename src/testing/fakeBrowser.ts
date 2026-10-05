// A stand-in tiktok.com for engine tests. The engine labels every evaluate
// with what it reads ("me", "ready @acme", "profile @acme", "video 7423…",
// "comments 7423…", "comments 7423… @40" for a later page), so the fake
// answers by label instead of running the scripts; the scripts themselves are tested against stand-in pages in
// scripts.test.ts.

import type { MonitorBrowser } from "../browser.js";
import type {
  CommentsSnapshot,
  FetchMeta,
  MeSnapshot,
  OriginSnapshot,
  ProfileSnapshot,
  RawComment,
  RawVideo,
  ReadySnapshot,
  VideoSnapshot,
} from "../scripts.js";

/** A video on the fake site: what its page says, and what its grid cell
 *  prints. */
export interface FakeVideo extends RawVideo {
  pinned?: boolean;
  /** Its page serves no data block, so only the grid can be read. */
  noDetail?: boolean;
}

export interface FakeCreator {
  followers: number;
  /** Newest first, as the grid draws them (pinned ones go first anyway). */
  videos: FakeVideo[];
  private?: boolean;
  /** The page never draws its grid, though the profile's data is there. */
  noGrid?: boolean;
  /** The page draws nothing and carries no data. */
  blank?: boolean;
}

export class FakeTikTok implements MonitorBrowser {
  url = "about:blank";
  signedIn = true;
  handle = "acme";
  uid = "6800000000000000001";
  /** Every page and request shows the captcha. */
  captcha = false;
  /** The read with this label shows the captcha. */
  captchaAt = "";
  /** The request with this label is answered with HTTP 429. */
  throttle = "";
  /** The network is down: every fetch fails before an answer. */
  offline = false;
  /** The comment list answers with nothing, as it does without TikTok's
   *  signature. */
  unsigned = false;
  creators: Record<string, FakeCreator> = {};
  /** Comments by video id, in the order the list returns them. */
  comments: Record<string, RawComment[]> = {};
  /** How many comments one page of the list holds, as count=20 asks. */
  pageSize = 20;
  readonly opened: string[] = [];
  readonly labels: string[] = [];

  async open(url: string): Promise<void> {
    this.url = url;
    this.opened.push(url);
  }

  async waitForLoad(): Promise<void> {}

  async evaluate<T>(_script: string, label = ""): Promise<T> {
    this.labels.push(label);
    return this.answer(label) as T;
  }

  /** The comment list pages read, by video id, in order: a list read three
   *  pages deep is there three times. */
  get listsRead(): string[] {
    return this.pagesRead.map((page) => page.split("@")[0]!);
  }

  /** The comment list pages read, as "id@cursor", in order. */
  get pagesRead(): string[] {
    return this.labels.filter((label) => label.startsWith("comments ")).map((label) => {
      const [id, cursor] = commentsLabel(label);
      return `${id}@${cursor}`;
    });
  }

  /** The video pages fetched, by id, in order. */
  get videosRead(): string[] {
    return this.labels.filter((label) => label.startsWith("video ")).map((label) => label.slice("video ".length));
  }

  private meta(label: string, status = 200): FetchMeta {
    const base: FetchMeta = { path: "", status, ok: status >= 200 && status < 300, refused: "", error: "", reason: "", captcha: false, throttled: false };
    if (this.offline) return { ...base, status: 0, ok: false, error: "Failed to fetch" };
    if (this.captcha || label === this.captchaAt) return { ...base, ok: false, captcha: true };
    if (label === this.throttle) return { ...base, status: 429, ok: false, throttled: true, refused: "Too Many Requests" };
    return base;
  }

  private creator(label: string): [string, FakeCreator | undefined] {
    const handle = label.slice(label.indexOf("@") + 1);
    return [handle, this.creators[handle]];
  }

  private video(id: string): FakeVideo | undefined {
    for (const creator of Object.values(this.creators)) {
      const found = creator.videos.find((video) => video.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private answer(label: string): unknown {
    if (label === "origin") {
      return { url: this.url, on_tiktok: this.url.startsWith("https://www.tiktok.com/"), login_page: false, captcha_page: this.captcha } satisfies OriginSnapshot;
    }
    if (label === "me") {
      const meta = this.meta(label);
      return {
        ...meta,
        has_data: meta.ok,
        signed_in: meta.ok && this.signedIn,
        user: meta.ok && this.signedIn ? { uid: this.uid, unique_id: this.handle, nickname: "Acme" } : null,
      } satisfies MeSnapshot;
    }
    if (label.startsWith("ready @")) {
      const [, creator] = this.creator(label);
      const items = creator && !creator.noGrid && !creator.blank && !creator.private ? creator.videos.length : 0;
      return { ready: this.captcha || items > 0 || !creator || !!creator.private || creator.videos.length === 0, captcha: this.captcha, items } satisfies ReadySnapshot;
    }
    if (label.startsWith("profile @")) {
      const [handle, creator] = this.creator(label);
      const empty: ProfileSnapshot = {
        url: this.url, captcha: this.captcha, has_data: false, status_code: null, found: false, private: false, user: null,
        followers: null, following: null, hearts: null, video_count: null, videos: [],
      };
      if (this.captcha || label === this.captchaAt) return { ...empty, captcha: true };
      if (creator?.blank) return empty;
      if (!creator) return { ...empty, has_data: true, status_code: 10221 } satisfies ProfileSnapshot;
      const drawn = creator.noGrid || creator.private ? [] : creator.videos;
      return {
        ...empty,
        has_data: true,
        status_code: creator.private ? 10222 : 0,
        found: true,
        private: !!creator.private,
        user: { id: `7${handle.length}`, unique_id: handle, nickname: handle },
        followers: creator.followers,
        following: 10,
        hearts: 1000,
        video_count: creator.videos.length,
        videos: drawn.map((video) => ({ id: video.id, author: video.author, pinned: !!video.pinned, views_text: printed(video.views ?? 0), alt: `${video.desc} created by ${video.author}` })),
      } satisfies ProfileSnapshot;
    }
    if (label.startsWith("video ")) {
      const id = label.slice("video ".length);
      const meta = this.meta(label);
      const video = this.video(id);
      if (!meta.ok || !video || video.noDetail) {
        return { ...meta, has_data: false, status_code: null, video: null, refused: meta.ok ? "the page carried no video data" : meta.refused } satisfies VideoSnapshot;
      }
      const { pinned: _pinned, noDetail: _noDetail, ...raw } = video;
      return { ...meta, has_data: true, status_code: 0, video: raw } satisfies VideoSnapshot;
    }
    if (label.startsWith("comments ")) {
      const [id, cursor] = commentsLabel(label);
      const meta = this.meta(label);
      const none = { unsigned: false, comments: [], total: null, cursor: null, has_more: false };
      if (!meta.ok) return { ...meta, ...none } satisfies CommentsSnapshot;
      if (this.unsigned) return { ...meta, ...none, ok: false, unsigned: true, refused: "an empty answer (HTTP 200)" } satisfies CommentsSnapshot;
      const all = this.comments[id] ?? [];
      const page = all.slice(cursor, cursor + this.pageSize);
      const next = cursor + page.length;
      return { ...meta, unsigned: false, comments: page, total: all.length, cursor: next, has_more: next < all.length } satisfies CommentsSnapshot;
    }
    throw new Error(`the fake has no answer for "${label}"`);
  }
}

/** commentsLabel reads "comments <id>" or "comments <id> @<cursor>". */
function commentsLabel(label: string): [string, number] {
  const [id = "", cursor = "@0"] = label.slice("comments ".length).split(" ");
  return [id, Number(cursor.slice(1)) || 0];
}

/** printed writes a count the way the grid prints it. */
function printed(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1e6) return `${Math.round(value / 100) / 10}K`;
  return `${Math.round(value / 1e5) / 10}M`;
}

/** NOON is the time minute 0 of the helpers below stands for. */
export const NOON = Date.UTC(2026, 9, 5, 12, 0, 0);

let serial = 0;

const seconds = (minute: number) => Math.floor((NOON + minute * 60_000) / 1000);

/** videoIdAt makes a video id the way TikTok does: the second it was posted
 *  in the top 32 bits, so it is too wide for a Number. */
export function videoIdAt(minute: number): string {
  return ((BigInt(seconds(minute)) << 32n) + BigInt(1000 + serial++)).toString();
}

/** video builds a video by `author`, posted `minute` minutes after NOON. */
export function video(author: string, minute: number, desc: string, patch: Partial<FakeVideo> = {}): FakeVideo {
  return { id: videoIdAt(minute), author, desc, create_time: seconds(minute), views: 500, likes: 40, comments: 0, shares: 1, saves: 2, ...patch };
}

/** comment builds a comment by `user`, written `minute` minutes after NOON. */
export function comment(user: string, minute: number, text: string, patch: Partial<RawComment> = {}): RawComment {
  return { cid: `74230000000000${String(10000 + serial++)}`, text, create_time: seconds(minute), likes: 0, replies: 0, user, nickname: user, ...patch };
}
