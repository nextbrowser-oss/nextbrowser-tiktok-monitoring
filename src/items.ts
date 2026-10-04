// What the monitor reports about one video or comment, with enough context to
// review it without opening TikTok: who, what, under which video, the counts,
// and a direct link.

import { commentUrl, videoTime, videoUrl } from "./ids.js";
import type { RawComment } from "./scripts.js";

export type ItemKind = "video" | "comment";

/** How an item concerns the monitored account. */
export type Addressed = "mention" | "reply" | "comment_on_video";

/** The video a comment is under, for context. */
export interface VideoContext {
  id: string;
  author: string;
  /** The description's opening, cut to 200 characters. */
  desc?: string;
  url: string;
}

/** What the monitor knows about one video: from its page when TikTok served
 *  the data, otherwise from the grid alone. */
export interface VideoFacts {
  id: string;
  author: string;
  desc: string;
  /** Milliseconds since the epoch: the video's own createTime, or the time
   *  in its id. */
  createdAt?: number;
  views?: number;
  /** The views are a rounded figure ("12.3K"). */
  viewsApproximate?: boolean;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** The video's page served no data: the views are the grid's rounded
   *  figure, the other counts are unknown, and the description is the
   *  cover's alt text. */
  partial: boolean;
  pinned?: boolean;
}

export interface TikTokItem {
  /** "video:<id>" or "comment:<id>": unique across sources. */
  key: string;
  id: string;
  kind: ItemKind;
  /** The handle of who posted it. */
  author: string;
  /** A video's description, a comment's text. Cut to 2,000 characters. */
  text: string;
  /** A direct link: the video. TikTok has no link to a single comment, so a
   *  comment's link is the video it is under. */
  url: string;
  /** The video a comment is under, or a video itself. */
  video?: VideoContext;
  /** Milliseconds since the epoch. */
  createdAt?: number;
  likes?: number;
  /** A comment's replies. */
  replies?: number;
  /** A video's counts when it was read. */
  views?: number;
  comments?: number;
  shares?: number;
  /** A video whose counts are the grid's rounded views only. */
  partial?: boolean;
  /** Views a video gained since the monitor last looked, when that crossed
   *  the engagement threshold. */
  viewsGained?: number;
  /** How it concerns the monitored account, when it does. */
  addressed?: Addressed;
}

const CONTEXT_DESC = 200;

function seconds(value: number | null | undefined): number | undefined {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined || value === null ? {} : { [key]: value }) as { [P in K]?: V };
}

/** videoContext describes a video for the comments under it. */
export function videoContext(video: Pick<VideoFacts, "id" | "author" | "desc">): VideoContext {
  const desc = video.desc.replace(/\s+/g, " ").trim().slice(0, CONTEXT_DESC);
  return { id: video.id, author: video.author, ...(desc ? { desc } : {}), url: videoUrl(video.author, video.id) };
}

/** videoItem reports a video: a watched creator's new one. */
export function videoItem(video: VideoFacts, addressed?: Addressed, viewsGained?: number): TikTokItem | undefined {
  if (!video.id || !video.author) return undefined;
  const context = videoContext(video);
  return {
    key: `video:${video.id}`,
    id: video.id,
    kind: "video",
    author: video.author,
    text: video.desc.trim(),
    url: context.url,
    video: context,
    ...optional("createdAt", video.createdAt ?? videoTime(video.id)),
    ...optional("likes", video.likes),
    ...optional("views", video.views),
    ...optional("comments", video.comments),
    ...optional("shares", video.shares),
    ...(video.partial ? { partial: true } : {}),
    ...(viewsGained !== undefined && viewsGained > 0 ? { viewsGained } : {}),
    ...(addressed ? { addressed } : {}),
  };
}

/** commentItem reports a comment under a video. */
export function commentItem(raw: RawComment, video: VideoContext, addressed?: Addressed): TikTokItem | undefined {
  if (!raw.cid || !raw.user) return undefined;
  return {
    key: `comment:${raw.cid}`,
    id: raw.cid,
    kind: "comment",
    author: raw.user,
    text: raw.text.trim(),
    url: commentUrl(video.author, video.id),
    video,
    ...optional("createdAt", seconds(raw.create_time)),
    ...optional("likes", raw.likes ?? undefined),
    ...optional("replies", raw.replies ?? undefined),
    ...(addressed ? { addressed } : {}),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A handle can hold periods but never ends with one: "@acme." ends a
 *  sentence, "@acme.eu" is somebody else, and so is "@acme_shop". */
function handlePattern(handle: string, anchored: boolean): RegExp {
  return new RegExp(`${anchored ? "^\\s*" : "(?<![\\w@.])"}@${escape(handle)}(?![\\w]|\\.\\w)`, "i");
}

/** mentions says whether a text names the handle with an @. */
export function mentions(text: string, handle: string): boolean {
  return !!handle && handlePattern(handle, false).test(text);
}

/** addressedBy says how a text concerns the account. A comment that opens
 *  with @account is how a reply to the account reads on TikTok; one that
 *  names it further in is a mention; anything else on the account's own video
 *  is a comment on it. */
export function addressedBy(text: string, handle: string, onOwnVideo: boolean): Addressed | undefined {
  if (handle && handlePattern(handle, true).test(text)) return "reply";
  if (mentions(text, handle)) return "mention";
  return onOwnVideo ? "comment_on_video" : undefined;
}

/** isOwn says whether the monitored account wrote the item. */
export function isOwn(item: TikTokItem, handle: string | undefined): boolean {
  return !!handle && item.author.toLowerCase() === handle.toLowerCase();
}

/** matchText is what a keyword may be found in: the item's own text. For a
 *  comment, the description of the video it is under is context, not a
 *  match. */
export function matchText(item: TikTokItem): string {
  return item.text;
}
