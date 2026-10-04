// What a pass reports. Events are plain JSON, so a caller can store them, send
// them over IPC, or print them one per line.

import type { TikTokItem } from "./items.js";
import type { Triage } from "./triage.js";

/** Where an item was found. */
export interface ItemSource {
  kind: "own_comments" | "creator_videos" | "creator_comments";
  /** "your videos", or "@handle" for a watched creator. */
  name: string;
}

/** An item that matched, ranked, with where it came from. It is what a
 *  new_item event carries, and what a pass hands back for a dashboard. */
export interface Match {
  item: TikTokItem;
  source: ItemSource;
  /** The keywords it names. */
  keywords: string[];
  triage: Triage;
}

/** Something new that needs a look: a comment on the account's video, a
 *  mention of or reply to the account, a watched creator's new video, or a
 *  comment under one that names a keyword. */
export interface NewItemEvent extends Match {
  type: "new_item";
  at: number;
  /** The monitored account, when the profile is signed in. */
  account?: string;
}

export type EngagementMetric = "views" | "likes" | "comments";

/** A video's views, likes or comments jumped since the last read, past the
 *  thresholds in settings.engagement. */
export interface EngagementChangedEvent {
  type: "engagement_changed";
  at: number;
  /** "video:<id>", the key a new_item for the same video carries. */
  key: string;
  videoId: string;
  url: string;
  /** The video's author. */
  handle: string;
  /** The video is the monitored account's own. */
  own: boolean;
  metric: EngagementMetric;
  previous: number;
  current: number;
  delta: number;
  /** One of the two figures is the grid's rounded count. */
  approximate?: boolean;
}

/** A follower count moved: the account's own, or a watched creator's. */
export interface FollowersChangedEvent {
  type: "followers_changed";
  at: number;
  handle: string;
  own: boolean;
  previous: number;
  current: number;
  delta: number;
}

/** The profile is signed in to tiktok.com, for the first time or again. */
export interface SignedInEvent {
  type: "signed_in";
  at: number;
  handle?: string;
}

/** The profile is signed out. Public creators are still read; the account's
 *  own videos and mentions of it wait for a sign-in. */
export interface SignedOutEvent {
  type: "signed_out";
  at: number;
  handle?: string;
}

/** A different account is signed in than before. Its own videos start over. */
export interface AccountChangedEvent {
  type: "account_changed";
  at: number;
  previous: string;
  current: string;
}

/** TikTok put its captcha in front of the profile. Nothing more is read until
 *  a person solves it in the profile. */
export interface SecurityCheckEvent {
  type: "security_check";
  at: number;
  handle?: string;
}

export type MonitorEvent =
  | NewItemEvent
  | EngagementChangedEvent
  | FollowersChangedEvent
  | SignedInEvent
  | SignedOutEvent
  | AccountChangedEvent
  | SecurityCheckEvent;
