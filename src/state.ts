// Monitor state and settings: one JSON document the caller owns and persists.
//
// A pass takes the state in and hands the next one back without mutating what
// it was given, so a pass cut short leaves the last saved state intact and
// everything a finished pass learned is in what it returned.

import { MAX_KEYWORDS, normalizeKeywords } from "./keywords.js";
import { videoId } from "./ids.js";
import { DEFAULT_URGENT_TERMS } from "./triage.js";

/** When a video's counts moved enough to be worth an engagement_changed. A
 *  ratio and a floor together: +50% of 40 views is noise, +900 views on a
 *  video with a million is too. */
export interface EngagementThresholds {
  /** Views grew by at least this share of the last reading… */
  viewsRatio: number;
  /** …and by at least this many. */
  viewsMin: number;
  likesRatio: number;
  likesMin: number;
  /** Comments grew by at least this many. */
  commentsMin: number;
}

export interface MonitorSettings {
  /** Creators to watch, without the @: competitors, partners, the accounts
   *  your customers watch. Each one's new videos are reported; the comments
   *  under them are reported when they name a keyword or the account. */
  creators: string[];
  /** Words and phrases to find: a brand, a product, a hashtag. */
  keywords: string[];
  /** Words that drop an item even when a keyword matched. */
  excludeKeywords: string[];
  /** Terms that make an item urgent; see triage.ts. */
  urgentTerms: string[];
  /** Read the signed-in account's own newest videos and the comments on
   *  them. Needs a signed-in profile. */
  watchOwnVideos: boolean;
  /** Read comment lists at all: under your videos, and under the creators'
   *  for keywords and mentions of you. */
  watchComments: boolean;
  /** How many of the account's newest videos are watched. */
  ownVideos: number;
  /** How many of each creator's newest videos are opened for their counts
   *  and comments. */
  videosPerCreator: number;
  /** How many comment pages one pass may ask for, across every video; a
   *  busy video's later pages count too. A video past this is read on the
   *  next pass instead, before the ones that did not wait. */
  maxCommentReads: number;
  /** Report engagement_changed when a watched video's counts jump. */
  trackEngagement: boolean;
  engagement: EngagementThresholds;
  /** How old an item may be and still be announced. 0 turns the limit off. */
  maxItemAgeMs: number;
  /** Track follower counts of the account and the creators. They come with
   *  the profile reads, so they cost no request of their own. */
  trackFollowers: boolean;
  /** Leave the tab on about:blank after a pass. */
  parkTab: boolean;
}

export interface AccountState {
  handle?: string;
  uid?: string;
  signedIn: boolean;
  checkedAt: number;
}

/** One thing the monitor reads: the comments on the account's videos, a
 *  creator's videos, or the comments under a creator's videos. */
export interface SourceState {
  /** When the source was first read with its current filter: nothing created
   *  before it is announced. */
  since: number;
  /** What it filtered by when `since` was set. */
  filter: string;
  lastReadAt?: number;
  lastNewAt?: number;
  note?: string;
}

export interface CountSample {
  at: number;
  value: number;
}

/** A comment read that ran out of pages — the per-video cap, or the pass's
 *  maxCommentReads — before it had found everything the count grew by. The
 *  watermark stays where it was and the next pass goes on from here. */
export interface CommentBacklog {
  /** Where the next pass picks the list up. */
  cursor: number;
  /** The comment count this read accounts for: the watermark moves to it
   *  once the read is done. */
  target: number;
  /** Comments newer than the watermark found so far. */
  found: number;
  /** When the read began, which becomes the watermark's time once it is
   *  done. */
  at: number;
  /** Passes spent on it so far. */
  passes: number;
}

/** What the monitor last knew about one video: its counts, to tell an
 *  engagement jump, and its comment watermark, to tell when its comments are
 *  worth reading again. */
export interface VideoWatch {
  handle: string;
  createdAt?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** The views above are the grid's rounded figure. */
  approximate?: boolean;
  /** The comment count when its comments were last read, or when it was first
   *  seen. A count above it means there is something new to read. Unknown
   *  until the video's page has served its counts once. */
  commentsRead?: number;
  /** When the watermark was taken: comments written after it are what the
   *  count grew by. */
  commentsReadAt?: number;
  /** A read of a busy video's list that the next pass goes on with. */
  commentsBacklog?: CommentBacklog;
  /** Passes in a row the list came back empty while the count said there
   *  were new comments: comments turned off, or held for review. */
  commentsEmpty?: number;
  /** When its new comments first had to wait for a later pass
   *  (maxCommentReads, or a backlog). The pass reads the creator and the
   *  video that have waited longest first. */
  commentsDueAt?: number;
  checkedAt: number;
  /** Views over time, a sample per change, bounded. */
  history: CountSample[];
}

export interface FollowerStats {
  handle: string;
  followers?: number;
  following?: number;
  hearts?: number;
  videos?: number;
  checkedAt?: number;
  changedAt?: number;
  history: CountSample[];
  note?: string;
}

export interface PassRecord {
  at: number;
  finishedAt: number;
  newItems: number;
  urgent: number;
  followerChanges: number;
  engagementChanges: number;
  notes: string[];
}

export interface MonitorState {
  version: 1;
  settings: MonitorSettings;
  account?: AccountState;
  /** Keyed by source: "comments:own", "creator:<handle>:videos",
   *  "creator:<handle>:comments". */
  sources: Record<string, SourceState>;
  /** Item keys already seen or announced, newest last, bounded, across every
   *  source. */
  seen: string[];
  /** Keyed by video id. */
  videos: Record<string, VideoWatch>;
  /** Keyed by lowercased handle; the account itself included. */
  followers: Record<string, FollowerStats>;
  lastPass?: PassRecord;
}

export const MAX_CREATORS = 10;
export const MAX_URGENT_TERMS = 50;
export const DEFAULT_OWN_VIDEOS = 6;
export const DEFAULT_VIDEOS_PER_CREATOR = 3;
export const DEFAULT_MAX_COMMENT_READS = 10;
/** Comments on TikTok keep arriving for days after a video is posted, and a
 *  video can resurface in For You a week later, so the window is wider than
 *  the other monitors'. */
export const DEFAULT_MAX_ITEM_AGE_MS = 72 * 60 * 60 * 1000;
export const MAX_SEEN = 5000;
export const MAX_VIDEOS_WATCHED = 300;
export const MAX_HISTORY = 200;
export const MAX_VIDEO_HISTORY = 48;
export const MAX_PASS_NOTES = 5;
/** How deep one pass pages into one video's comment list. */
export const MAX_COMMENT_PAGES = 3;
/** How many passes a video's comment watermark is held for an answer that
 *  does not account for its count — an empty list, or a backlog — before it
 *  is moved on with a note. */
export const MAX_HELD_PASSES = 3;

/** TikTok usernames: letters, digits, underscores and periods, never ending
 *  with a period. TikTok caps new ones at 24 characters; older accounts are
 *  allowed a little more room here. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function defaultThresholds(): EngagementThresholds {
  return { viewsRatio: 0.5, viewsMin: 1000, likesRatio: 0.5, likesMin: 500, commentsMin: 20 };
}

export function defaultSettings(): MonitorSettings {
  return {
    creators: [],
    keywords: [],
    excludeKeywords: [],
    urgentTerms: [...DEFAULT_URGENT_TERMS],
    watchOwnVideos: true,
    watchComments: true,
    ownVideos: DEFAULT_OWN_VIDEOS,
    videosPerCreator: DEFAULT_VIDEOS_PER_CREATOR,
    maxCommentReads: DEFAULT_MAX_COMMENT_READS,
    trackEngagement: true,
    engagement: defaultThresholds(),
    maxItemAgeMs: DEFAULT_MAX_ITEM_AGE_MS,
    trackFollowers: true,
    parkTab: true,
  };
}

export function emptyState(settings: Partial<MonitorSettings> = {}): MonitorState {
  return { version: 1, settings: normalizeSettings(settings), sources: {}, seen: [], videos: {}, followers: {} };
}

/** normalizeHandle accepts "@name", a profile or video URL or a bare name,
 *  and returns the name, or "" for anything that cannot be a TikTok username.
 *  A short link (vm.tiktok.com/…) names no one until it is followed, so it is
 *  refused. */
export function normalizeHandle(value: unknown): string {
  let text = String(value ?? "").trim();
  if (/^https?:\/\//i.test(text) || /^(?:www\.|m\.)?tiktok\.com\//i.test(text)) {
    const match = /^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([^/?#]+)/i.exec(text);
    if (!match) return "";
    text = match[1] ?? "";
  }
  text = text.replace(/^@+/, "").replace(/[/?#].*$/, "");
  if (text.endsWith(".") || text.includes("..")) return "";
  return HANDLE.test(text) ? text : "";
}

function integer(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function ratio(value: unknown, fallback: number): number {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(10, Math.max(0.1, Math.round(number * 100) / 100));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeThresholds(raw: unknown): EngagementThresholds {
  const base = defaultThresholds();
  const record = raw && typeof raw === "object" ? (raw as Partial<EngagementThresholds>) : {};
  return {
    viewsRatio: ratio(record.viewsRatio, base.viewsRatio),
    viewsMin: integer(record.viewsMin, base.viewsMin, 100, 1e9),
    likesRatio: ratio(record.likesRatio, base.likesRatio),
    likesMin: integer(record.likesMin, base.likesMin, 10, 1e9),
    commentsMin: integer(record.commentsMin, base.commentsMin, 1, 1e6),
  };
}

export function normalizeSettings(raw: unknown): MonitorSettings {
  const base = defaultSettings();
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorSettings>) : {};
  const creators: string[] = [];
  for (const value of Array.isArray(record.creators) ? record.creators : []) {
    const handle = normalizeHandle(value);
    if (handle && !creators.some((known) => known.toLowerCase() === handle.toLowerCase())) creators.push(handle);
  }
  return {
    creators: creators.slice(0, MAX_CREATORS),
    keywords: normalizeKeywords(record.keywords, MAX_KEYWORDS),
    excludeKeywords: normalizeKeywords(record.excludeKeywords, MAX_KEYWORDS),
    urgentTerms: Array.isArray(record.urgentTerms) ? normalizeKeywords(record.urgentTerms, MAX_URGENT_TERMS) : base.urgentTerms,
    watchOwnVideos: flag(record.watchOwnVideos, base.watchOwnVideos),
    watchComments: flag(record.watchComments, base.watchComments),
    ownVideos: integer(record.ownVideos, base.ownVideos, 0, 12),
    videosPerCreator: integer(record.videosPerCreator, base.videosPerCreator, 0, 10),
    maxCommentReads: integer(record.maxCommentReads, base.maxCommentReads, 0, 30),
    trackEngagement: flag(record.trackEngagement, base.trackEngagement),
    engagement: normalizeThresholds(record.engagement),
    maxItemAgeMs: integer(record.maxItemAgeMs, base.maxItemAgeMs, 0),
    trackFollowers: flag(record.trackFollowers, base.trackFollowers),
    parkTab: flag(record.parkTab, base.parkTab),
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function count(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

function backlog(raw: unknown): CommentBacklog | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Partial<CommentBacklog>;
  const cursor = count(record.cursor);
  const target = count(record.target);
  const at = finite(record.at);
  if (cursor === undefined || target === undefined || at === undefined) return undefined;
  return { cursor, target, found: count(record.found) ?? 0, at, passes: count(record.passes) ?? 0 };
}

function history(raw: unknown, max: number): CountSample[] {
  return Array.isArray(raw)
    ? raw
      .filter((sample) => sample && finite(sample.at) !== undefined && finite(sample.value) !== undefined)
      .map((sample) => ({ at: sample.at as number, value: sample.value as number }))
      .slice(-max)
    : [];
}

/** normalizeState accepts whatever was on disk, including a file from an
 *  older version or a hand edit, and returns something a pass can run on. */
export function normalizeState(raw: unknown): MonitorState {
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorState>) : {};
  const state = emptyState(record.settings ?? {});

  const account = record.account;
  if (account && typeof account === "object") {
    const handle = normalizeHandle(account.handle);
    const uid = videoId(account.uid);
    state.account = { ...(handle ? { handle } : {}), ...(uid ? { uid } : {}), signedIn: account.signedIn === true, checkedAt: finite(account.checkedAt) ?? 0 };
  }

  for (const [key, value] of Object.entries(record.sources ?? {})) {
    if (!value || typeof value !== "object" || finite(value.since) === undefined) continue;
    state.sources[key] = {
      since: value.since,
      filter: typeof value.filter === "string" ? value.filter : "",
      ...optional("lastReadAt", finite(value.lastReadAt)),
      ...optional("lastNewAt", finite(value.lastNewAt)),
      ...optional("note", text(value.note)),
    };
  }

  state.seen = Array.isArray(record.seen)
    ? record.seen.filter((key): key is string => typeof key === "string" && !!key).slice(-MAX_SEEN)
    : [];

  const videos = Object.entries(record.videos ?? {})
    .filter(([id, value]) => videoId(id) && value && typeof value === "object" && normalizeHandle(value.handle))
    .sort(([, left], [, right]) => (finite(left.checkedAt) ?? 0) - (finite(right.checkedAt) ?? 0))
    .slice(-MAX_VIDEOS_WATCHED);
  for (const [id, value] of videos) {
    state.videos[videoId(id)] = {
      handle: normalizeHandle(value.handle),
      ...optional("createdAt", finite(value.createdAt)),
      ...optional("views", finite(value.views)),
      ...optional("likes", finite(value.likes)),
      ...optional("comments", finite(value.comments)),
      ...optional("shares", finite(value.shares)),
      ...optional("saves", finite(value.saves)),
      ...(value.approximate === true ? { approximate: true } : {}),
      ...optional("commentsRead", finite(value.commentsRead)),
      ...optional("commentsReadAt", finite(value.commentsReadAt)),
      ...optional("commentsBacklog", backlog(value.commentsBacklog)),
      ...optional("commentsEmpty", count(value.commentsEmpty) || undefined),
      ...optional("commentsDueAt", finite(value.commentsDueAt)),
      checkedAt: finite(value.checkedAt) ?? 0,
      history: history(value.history, MAX_VIDEO_HISTORY),
    };
  }

  for (const [key, value] of Object.entries(record.followers ?? {})) {
    if (!value || typeof value !== "object") continue;
    const handle = normalizeHandle(value.handle ?? key);
    if (!handle) continue;
    state.followers[handle.toLowerCase()] = {
      handle,
      ...optional("followers", finite(value.followers)),
      ...optional("following", finite(value.following)),
      ...optional("hearts", finite(value.hearts)),
      ...optional("videos", finite(value.videos)),
      ...optional("checkedAt", finite(value.checkedAt)),
      ...optional("changedAt", finite(value.changedAt)),
      history: history(value.history, MAX_HISTORY),
      ...optional("note", text(value.note)),
    };
  }

  const pass = record.lastPass;
  if (pass && typeof pass === "object" && finite(pass.at) !== undefined) {
    state.lastPass = {
      at: pass.at,
      finishedAt: finite(pass.finishedAt) ?? pass.at,
      newItems: finite(pass.newItems) ?? 0,
      urgent: finite(pass.urgent) ?? 0,
      followerChanges: finite(pass.followerChanges) ?? 0,
      engagementChanges: finite(pass.engagementChanges) ?? 0,
      notes: Array.isArray(pass.notes) ? pass.notes.filter((note): note is string => typeof note === "string").slice(-MAX_PASS_NOTES) : [],
    };
  }
  return state;
}

/** A change to the settings: any of them, and any of the thresholds. */
export type SettingsPatch = Partial<Omit<MonitorSettings, "engagement">> & { engagement?: Partial<EngagementThresholds> };

/** withSettings applies a settings patch, normalized. An engagement patch is
 *  merged into the thresholds already set, so one can be changed alone. */
export function withSettings(state: MonitorState, patch: SettingsPatch): MonitorState {
  const engagement = patch.engagement ? { ...state.settings.engagement, ...patch.engagement } : state.settings.engagement;
  return { ...state, settings: normalizeSettings({ ...state.settings, ...patch, engagement }) };
}
