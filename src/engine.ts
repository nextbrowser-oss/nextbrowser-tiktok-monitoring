// One monitoring pass: who is signed in, what the account's newest videos
// and the watched creators' look like now, which of their videos are new,
// which new comments landed under them, which of those mention the account or
// name a keyword, how urgent each one is, and whether a video's counts or a
// follower count jumped.
//
// The pass is a state machine over an explicit MonitorState, like the X,
// Reddit and Instagram monitors: state in, next state and events out, nothing
// mutated. The caller persists the state and schedules the next pass.
//
// Everything is read, nothing is done: no like, no comment, no reply, no
// follow. Answering is the reply agent's job, with the person's approval.
//
// A creator is read by opening their page, the one flow tiktok.com serves to
// any browser, signed in or not. Their newest videos' pages are then fetched
// for exact counts, and a video's comment list is asked for only when its
// comment count grew since the last look. A pass reads at most
// maxCommentReads lists; a video past that waits for the next pass with its
// old watermark, so nothing is skipped, only delayed. When TikTok will not
// answer the comment list without its own signature, comments are skipped for
// the pass, with a note, and the watermarks stay where they were so a later
// pass tries again.

import type { MonitorBrowser } from "./browser.js";
import { parseCount } from "./counts.js";
import type { EngagementMetric, ItemSource, Match, MonitorEvent } from "./events.js";
import { creatorUrl, videoTime, videoUrl } from "./ids.js";
import { addressedBy, commentItem, isOwn, matchText, mentions, videoContext, videoItem, type TikTokItem, type VideoFacts } from "./items.js";
import { keywordMatcher, signature, type Matcher } from "./keywords.js";
import { errorText, makeLogger, type LogSink, type Logger } from "./log.js";
import {
  LANDING_URL,
  NOT_FOUND_CODES,
  SIGN_IN_URL,
  commentsScript,
  meScript,
  originScript,
  profileScript,
  readyScript,
  videoScript,
  type CommentsSnapshot,
  type FetchMeta,
  type MeSnapshot,
  type OriginSnapshot,
  type ProfileSnapshot,
  type RawGridVideo,
  type RawVideo,
  type ReadySnapshot,
  type VideoSnapshot,
} from "./scripts.js";
import {
  MAX_HISTORY,
  MAX_PASS_NOTES,
  MAX_SEEN,
  MAX_VIDEO_HISTORY,
  MAX_VIDEOS_WATCHED,
  normalizeHandle,
  normalizeState,
  type FollowerStats,
  type MonitorState,
  type SourceState,
  type VideoWatch,
} from "./state.js";
import { byUrgency, triage } from "./triage.js";

const BLANK_PAGE = "about:blank";
const LOAD_WAIT_SECONDS = 20;
/** How long a creator page is given to draw its grid once the document has
 *  loaded. The grid comes from the web app's own data call after the page,
 *  and over a residential proxy that call alone can take seconds. */
export const READY_WAIT_MS = 20_000;
const POLL_MS = 500;

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PassDeps {
  browser: MonitorBrowser;
  state: MonitorState;
  now?: () => number;
  sleep?: Sleep;
  /** A source of numbers in [0, 1), for the pauses a person would take. */
  random?: () => number;
  log?: LogSink;
  /** Called for every event as it happens, before the pass returns. */
  onEvent?: (event: MonitorEvent) => void;
  /** Called with what the pass is doing, for a status line. */
  onStep?: (step: string) => void;
  /** Checked between requests, so Stop ends the pass instead of waiting it
   *  out. */
  shouldStop?: () => boolean;
}

export interface PassSummary {
  signedIn: boolean;
  handle?: string;
  /** The settings ask for the account's own videos and the profile is signed
   *  out. Public creators were read anyway. */
  loginRequired: boolean;
  /** TikTok put its captcha in front of the profile. Someone has to open
   *  tiktok.com in the profile and solve it. */
  securityCheck: boolean;
  /** TikTok is limiting the profile, and the pass stopped early. */
  rateLimited: boolean;
  /** Why the pass stopped reading, when it did: a captcha, a rate limit, a
   *  site that could not be reached or refused the profile. The next pass
   *  should back off. */
  blocked?: string;
  /** Requests fetched from tiktok.com: the account, video pages, comment
   *  lists. */
  requests: number;
  /** Creator pages opened in the tab. */
  pageLoads: number;
  sourcesRead: number;
  /** Sources read for the first time, or with a new keyword set: what they
   *  hold is the starting line, and nothing in them is announced. */
  baselines: number;
  itemsRead: number;
  /** Items that matched, new or not, inside the age window. */
  matches: number;
  newItems: number;
  /** New items triaged as high urgency. */
  urgent: number;
  /** Video pages fetched for exact counts, and those of them that served no
   *  data, whose counts came from the grid instead. */
  videoReads: number;
  partialVideos: number;
  /** Comment lists read, and lists that grew but wait for the next pass
   *  because this one had read its share. */
  commentReads: number;
  commentReadsDeferred: number;
  /** TikTok would not answer a comment list without its own signature, so
   *  comments were skipped for the rest of the pass. */
  commentsRefused: boolean;
  followerChecks: number;
  followerChanges: number;
  engagementChanges: number;
  stopped: boolean;
  notes: string[];
}

export interface PassResult {
  state: MonitorState;
  events: MonitorEvent[];
  summary: PassSummary;
  /** Every item the pass found that matched, new or not, inside the age
   *  window, most urgent first: what a dashboard shows. */
  matches: Match[];
}

export interface AccountCheck {
  signedIn: boolean;
  handle?: string;
  /** TikTok wants its captcha solved before anything else. */
  securityCheck?: boolean;
  /** Why tiktok.com could not be read at all. */
  blocked?: string;
}

class StopRequested extends Error {}
class Blocked extends Error {}
class SecurityCheck extends Error {}
class RateLimited extends Error {}

const SECURITY_NOTE = "TikTok put a captcha in front of this profile. Open tiktok.com in the profile and solve it; monitoring picks up on the next pass, which waits longer.";
const COMMENTS_REFUSED_NOTE = "TikTok did not answer the comment list without its own signature; comments were skipped this pass (see troubleshooting).";
const SIGNED_OUT_NOTE = "The profile is not signed in to tiktok.com: comments on your videos and mentions of your account wait for a sign-in; public creators are read as usual.";

/** checkAccount opens tiktok.com and reads who is signed in, and stops there:
 *  nothing else is read, and the page is left open for a person who is about
 *  to sign in. It is what a panel calls before any monitoring has run. */
export async function checkAccount(deps: { browser: MonitorBrowser; now?: () => number; log?: LogSink }): Promise<AccountCheck> {
  const log = makeLogger(deps.log, deps.now ?? Date.now);
  await deps.browser.open(SIGN_IN_URL);
  await deps.browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
  const where = await deps.browser.evaluate<OriginSnapshot>(originScript(), "origin");
  if (where.captcha_page) return { signedIn: false, securityCheck: true };
  if (!where.on_tiktok) return { signedIn: false, blocked: `The tab did not reach tiktok.com (it shows ${where.url}).` };
  // The home page is open, so the account is read from it rather than fetched.
  const me = await deps.browser.evaluate<MeSnapshot>(meScript(true), "me");
  log("identity", { has_data: me.has_data, signed_in: me.signed_in, user: me.user?.unique_id, captcha: me.captcha });
  if (me.captcha) return { signedIn: false, securityCheck: true };
  if (me.signed_in && me.user) return { signedIn: true, handle: me.user.unique_id };
  if (!me.has_data) return { signedIn: false, blocked: "tiktok.com did not say who is signed in: the page carried no account data." };
  return { signedIn: false };
}

/** runPass runs one monitoring pass. It does not throw for anything TikTok or
 *  the browser does; failures end up in the summary's notes and the log. */
export async function runPass(deps: PassDeps): Promise<PassResult> {
  return new Pass(deps).run();
}

interface SourceRead {
  key: string;
  source: ItemSource;
  /** What the source is filtered by, for SourceState.filter. */
  filter: string;
  /** Whether an item must name a keyword, or be addressed to the account, to
   *  count. */
  filtered: boolean;
  items: TikTokItem[];
}

class Pass {
  private readonly browser: MonitorBrowser;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly deps: PassDeps;
  private readonly at: number;
  private state: MonitorState;
  private readonly events: MonitorEvent[] = [];
  private readonly matches = new Map<string, Match>();
  private readonly seen: Set<string>;
  private readonly seenOrder: string[];
  private readonly sources: Record<string, SourceState> = {};
  private readonly videos: Record<string, VideoWatch>;
  private readonly planned = new Set<string>();
  private readonly keywords: Matcher;
  private readonly excluded: Matcher;
  private readonly urgent: Matcher;
  private handle = "";
  private readonly summary: PassSummary = {
    signedIn: false,
    loginRequired: false,
    securityCheck: false,
    rateLimited: false,
    requests: 0,
    pageLoads: 0,
    sourcesRead: 0,
    baselines: 0,
    itemsRead: 0,
    matches: 0,
    newItems: 0,
    urgent: 0,
    videoReads: 0,
    partialVideos: 0,
    commentReads: 0,
    commentReadsDeferred: 0,
    commentsRefused: false,
    followerChecks: 0,
    followerChanges: 0,
    engagementChanges: 0,
    stopped: false,
    notes: [],
  };

  constructor(deps: PassDeps) {
    this.deps = deps;
    this.browser = deps.browser;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.log = makeLogger(deps.log, this.now);
    this.at = this.now();
    this.state = normalizeState(deps.state);
    this.seenOrder = [...this.state.seen];
    this.seen = new Set(this.seenOrder);
    this.videos = { ...this.state.videos };
    const settings = this.state.settings;
    this.keywords = keywordMatcher(settings.keywords);
    this.excluded = keywordMatcher(settings.excludeKeywords);
    this.urgent = keywordMatcher(settings.urgentTerms);
  }

  async run(): Promise<PassResult> {
    this.log("pass_start", { settings: this.state.settings, account: this.state.account?.handle });
    const settings = this.state.settings;
    try {
      await this.land();
      await this.readAccount();
      const own = settings.watchOwnVideos && !!this.handle;
      if (own) await this.readCreator(this.handle, true);
      for (const handle of settings.creators) {
        if (handle.toLowerCase() === this.handle.toLowerCase()) continue;
        await this.readCreator(handle, false);
      }
      if (!own && settings.creators.length === 0) {
        this.note("Nothing to watch yet: add creators, or sign the profile in to watch your own videos.");
      }
    } catch (error) {
      if (error instanceof StopRequested) {
        this.summary.stopped = true;
      } else if (error instanceof SecurityCheck) {
        this.securityCheck();
      } else if (error instanceof Blocked) {
        this.summary.blocked = error.message;
        this.note(error.message);
      } else if (error instanceof RateLimited) {
        this.summary.rateLimited = true;
        this.summary.blocked = error.message;
        this.note(error.message);
      } else {
        this.note(`The pass failed: ${errorText(error)}`);
        this.log("pass_error", { error: errorText(error) });
      }
    } finally {
      await this.park();
    }
    this.finish();
    const matches = [...this.matches.values()].sort(byUrgency);
    this.summary.matches = matches.length;
    this.log("pass_end", { ...this.summary });
    return { state: this.state, events: this.events, summary: this.summary, matches };
  }

  // --- landing and account ---------------------------------------------------

  /** land puts the tab on tiktok.com, which every fetch is made from. A tab
   *  already on tiktok.com — usually the last creator page of the previous
   *  pass, with parkTab off — is used as it is. */
  private async land(): Promise<void> {
    this.step("Opening tiktok.com");
    const current = await this.browser.evaluate<OriginSnapshot>(originScript(), "origin").catch(() => undefined);
    if (current?.on_tiktok && !current.login_page && !current.captcha_page) return;
    await this.browser.open(LANDING_URL);
    await this.browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
    const landed = await this.browser.evaluate<OriginSnapshot>(originScript(), "origin");
    this.log("landed", { ...landed });
    if (landed.captcha_page) throw new SecurityCheck();
    if (!landed.on_tiktok) throw new Blocked(`The tab did not reach tiktok.com (it shows ${landed.url}).`);
  }

  /** readAccount reads who is signed in from the home page's data block. A
   *  signed-out profile is not the end of the pass, unlike on Instagram:
   *  creators' pages are public, and only the account's own videos and
   *  mentions of it need a sign-in. */
  private async readAccount(): Promise<void> {
    this.step("Reading the signed-in account");
    const me = await this.fetch<MeSnapshot>(meScript(), "me");
    const previous = this.state.account;
    if (me.status === 403 || me.status === 451) {
      // TikTok answers a whole country with this (it is unavailable in some),
      // and a proxy in one of them gets it on every page.
      throw new Blocked(`tiktok.com refused the profile (HTTP ${me.status}${me.refused ? `: ${me.refused}` : ""}). TikTok is not available in every country: check the proxy's country.`);
    }
    if (!me.has_data) {
      // Neither signed in nor out: the account stays what it was.
      this.note(`tiktok.com did not say who is signed in (HTTP ${me.status}${me.refused ? `: ${me.refused}` : ""}); public creators are read as usual.`);
      if (previous?.signedIn && previous.handle) {
        this.handle = previous.handle;
        this.summary.signedIn = true;
        this.summary.handle = previous.handle;
      }
      return;
    }
    if (!me.signed_in || !me.user) {
      if (previous?.signedIn !== false) this.emit({ type: "signed_out", at: this.at, ...(previous?.handle ? { handle: previous.handle } : {}) });
      this.state = {
        ...this.state,
        account: { ...(previous?.handle ? { handle: previous.handle } : {}), ...(previous?.uid ? { uid: previous.uid } : {}), signedIn: false, checkedAt: this.at },
      };
      this.summary.signedIn = false;
      if (this.state.settings.watchOwnVideos) this.summary.loginRequired = true;
      this.note(SIGNED_OUT_NOTE);
      return;
    }
    const handle = normalizeHandle(me.user.unique_id) || previous?.handle || "";
    if (!previous?.signedIn) this.emit({ type: "signed_in", at: this.at, ...(handle ? { handle } : {}) });
    if (previous?.handle && handle && previous.handle.toLowerCase() !== handle.toLowerCase()) {
      this.emit({ type: "account_changed", at: this.at, previous: previous.handle, current: handle });
      // Another account has its own videos and its own comments: they start
      // over as a baseline.
      this.state = {
        ...this.state,
        sources: Object.fromEntries(Object.entries(this.state.sources).filter(([key]) => key !== "comments:own")),
      };
      for (const [id, watch] of Object.entries(this.videos)) {
        if (watch.handle.toLowerCase() === previous.handle.toLowerCase()) delete this.videos[id];
      }
    }
    this.handle = handle;
    this.state = { ...this.state, account: { ...(handle ? { handle } : {}), ...(me.user.uid ? { uid: me.user.uid } : {}), signedIn: true, checkedAt: this.at } };
    this.summary.signedIn = true;
    if (handle) this.summary.handle = handle;
  }

  private securityCheck(): void {
    const handle = this.handle || this.state.account?.handle;
    this.emit({ type: "security_check", at: this.at, ...(handle ? { handle } : {}) });
    this.summary.securityCheck = true;
    this.summary.blocked = SECURITY_NOTE;
    this.note(SECURITY_NOTE);
  }

  // --- creators --------------------------------------------------------------

  /** readCreator reads one creator, or the account itself: their follower
   *  count, their videos, the newest ones' exact counts, and the new comments
   *  under those. */
  private async readCreator(handle: string, own: boolean): Promise<void> {
    const settings = this.state.settings;
    const lower = handle.toLowerCase();
    const videosKey = `creator:${lower}:videos`;
    const commentsKey = own ? "comments:own" : `creator:${lower}:comments`;
    // Under someone else's video only what names a keyword or the account is
    // reported, so without either there is nothing to read the lists for.
    const readComments = settings.watchComments && (own || settings.keywords.length > 0 || !!this.handle);
    this.step(own ? "Reading your videos" : `Reading @${handle}`);
    if (!own) this.planned.add(videosKey);
    if (readComments) this.planned.add(commentsKey);
    const failedKey = own ? commentsKey : videosKey;

    const page = await this.openCreator(handle);
    if (page.captcha) throw new SecurityCheck();
    const code = page.status_code;
    if (code !== null && code >= 10000 && code < 10100) {
      throw new RateLimited(`TikTok is limiting this profile (statusCode ${code} on @${handle}). The pass stopped; the next one waits longer.`);
    }
    if (!page.found) {
      const why = code !== null && NOT_FOUND_CODES.includes(code)
        ? `@${handle} was not found on TikTok: check the spelling.`
        : page.has_data && code !== null && code !== 0
          ? `TikTok would not show @${handle} (statusCode ${code}); it is tried again next pass.`
          : `TikTok drew nothing for @${handle} (a slow page, a sign-in prompt or a captcha); it is read again next pass.`;
      this.sourceFailed(failedKey, why);
      return;
    }
    this.recordFollowers(handle, own, page);
    if (page.private && page.videos.length === 0) {
      this.sourceFailed(failedKey, `@${handle} is private: only the followers it approves see its videos.`);
      return;
    }
    if (page.videos.length === 0 && page.video_count !== 0) {
      // The profile is there — its followers were just read from its data —
      // but the web app drew no grid in time: a captcha over the grid, a
      // sign-in prompt, or a slow proxy. The videos keep their old state.
      this.sourceFailed(failedKey, `TikTok drew no video grid for @${handle} (captcha, login prompt or a slow page); videos are read next pass.`);
      return;
    }

    const limit = own ? settings.ownVideos : settings.videosPerCreator;
    const watched = new Set(newest(page.videos, limit).map((cell) => cell.id));
    const commentsSource = this.state.sources[commentsKey];
    const items: TikTokItem[] = [];
    const comments: TikTokItem[] = [];
    for (const cell of page.videos) {
      let facts = gridFacts(cell, handle);
      let gained: number | undefined;
      if (watched.has(cell.id)) {
        const detail = await this.readVideo(facts.author, cell.id);
        if (detail) facts = detailFacts(detail, facts);
        gained = this.watchVideo(facts, own);
        if (readComments) comments.push(...await this.readThread(facts, own, commentsSource));
        else this.keepWatermark(facts);
      }
      const addressed = !own && this.handle && mentions(facts.desc, this.handle) ? "mention" : undefined;
      const item = videoItem(facts, addressed, gained);
      if (item) items.push(item);
    }

    // The account's own videos are never news to it; the comments on them are.
    if (!own) {
      this.consider({ key: videosKey, source: { kind: "creator_videos", name: `@${handle}` }, filter: "all", filtered: false, items });
    }
    if (readComments) {
      this.consider({
        key: commentsKey,
        source: own ? { kind: "own_comments", name: "your videos" } : { kind: "creator_comments", name: `@${handle}` },
        filter: own ? "" : signature(settings.keywords),
        filtered: !own,
        items: comments,
      });
    }
  }

  /** openCreator opens a creator's page, waits until it has drawn its grid or
   *  a state with no grid to come, and reads it. Running out of time is not a
   *  failure: the read says what the page shows. */
  private async openCreator(handle: string): Promise<ProfileSnapshot> {
    this.checkStop();
    // Opening a page is what a person does every few seconds at most, and
    // TikTok draws its captcha for a browser that does it faster.
    if (this.summary.requests + this.summary.pageLoads > 0) await this.sleep(this.pause(3000, 7000));
    this.checkStop();
    const started = this.now();
    const label = handle.toLowerCase();
    await this.browser.open(creatorUrl(handle));
    this.summary.pageLoads += 1;
    await this.browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
    const deadline = this.now() + READY_WAIT_MS;
    let ready: ReadySnapshot | undefined;
    for (;;) {
      ready = await this.browser.evaluate<ReadySnapshot>(readyScript(), `ready @${label}`).catch(() => undefined);
      if (ready?.ready) break;
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(POLL_MS, remaining));
      this.checkStop();
    }
    const page = await this.browser.evaluate<ProfileSnapshot>(profileScript(), `profile @${label}`);
    this.log("page", {
      handle,
      url: page.url,
      ms: this.now() - started,
      ready: ready?.ready === true,
      captcha: page.captcha,
      has_data: page.has_data,
      status_code: page.status_code,
      found: page.found,
      private: page.private,
      videos: page.videos.length,
    });
    return page;
  }

  /** readVideo fetches one video's page for its exact counts. A page that
   *  serves no data leaves the video with what the grid showed. */
  private async readVideo(handle: string, id: string): Promise<RawVideo | undefined> {
    const snapshot = await this.fetch<VideoSnapshot>(videoScript(handle, id), `video ${id}`);
    this.summary.videoReads += 1;
    if (snapshot.video && snapshot.video.id === id) return snapshot.video;
    this.summary.partialVideos += 1;
    this.log("video_partial", { video: id, status: snapshot.status, status_code: snapshot.status_code, refused: snapshot.refused });
    return undefined;
  }

  /** watchVideo records a video's counts, reports the ones that jumped, and
   *  returns the views gained when that jump crossed the threshold. */
  private watchVideo(facts: VideoFacts, own: boolean): number | undefined {
    const previous = this.videos[facts.id];
    const known = (value: number | undefined, before: number | undefined) => (facts.partial ? before : value ?? before);
    const views = facts.views ?? previous?.views;
    const next: VideoWatch = {
      handle: facts.author,
      ...(facts.createdAt !== undefined ? { createdAt: facts.createdAt } : previous?.createdAt !== undefined ? { createdAt: previous.createdAt } : {}),
      ...(views !== undefined ? { views } : {}),
      ...optional("likes", known(facts.likes, previous?.likes)),
      ...optional("comments", known(facts.comments, previous?.comments)),
      ...optional("shares", known(facts.shares, previous?.shares)),
      ...optional("saves", known(facts.saves, previous?.saves)),
      ...(facts.views !== undefined ? (facts.viewsApproximate ? { approximate: true } : {}) : previous?.approximate ? { approximate: true } : {}),
      ...(previous?.commentsRead !== undefined ? { commentsRead: previous.commentsRead } : {}),
      checkedAt: this.at,
      history: previous?.history ?? [],
    };
    if (views !== undefined && views !== previous?.views) {
      next.history = [...next.history, { at: this.at, value: views }].slice(-MAX_VIDEO_HISTORY);
    }
    this.videos[facts.id] = next;
    if (!previous || !this.state.settings.trackEngagement) return undefined;

    const thresholds = this.state.settings.engagement;
    let gained: number | undefined;
    const check = (metric: EngagementMetric, before: number | undefined, after: number | undefined, min: number, ratio: number, approximate: boolean) => {
      if (before === undefined || after === undefined) return;
      const delta = after - before;
      if (delta < min || delta < before * ratio) return;
      this.emit({
        type: "engagement_changed",
        at: this.at,
        key: `video:${facts.id}`,
        videoId: facts.id,
        url: videoUrl(facts.author, facts.id),
        handle: facts.author,
        own,
        metric,
        previous: before,
        current: after,
        delta,
        ...(approximate ? { approximate: true } : {}),
      });
      this.summary.engagementChanges += 1;
      if (metric === "views") gained = delta;
    };
    check("views", previous.views, facts.views, thresholds.viewsMin, thresholds.viewsRatio, !!previous.approximate || !!facts.viewsApproximate);
    if (!facts.partial) {
      check("likes", previous.likes, facts.likes, thresholds.likesMin, thresholds.likesRatio, false);
      check("comments", previous.comments, facts.comments, thresholds.commentsMin, 0, false);
    }
    return gained;
  }

  /** readThread reads a video's comments when its count grew past the
   *  watermark. A video seen for the first time only sets its watermark,
   *  unless it was posted after the source started: then every comment on it
   *  is new. */
  private async readThread(facts: VideoFacts, own: boolean, source: SourceState | undefined): Promise<TikTokItem[]> {
    const count = facts.partial ? undefined : facts.comments;
    // Without the video's own counts there is no telling whether anything was
    // added; the watermark waits for a pass that gets them.
    if (count === undefined) return [];
    const watch = this.videos[facts.id];
    const postedSince = !!source && facts.createdAt !== undefined && facts.createdAt >= source.since;
    const mark = watch?.commentsRead ?? (postedSince ? 0 : count);
    if (count <= mark) {
      this.setWatermark(facts.id, count);
      return [];
    }
    if (this.summary.commentsRefused) {
      this.setWatermark(facts.id, mark);
      return [];
    }
    if (this.summary.commentReads >= this.state.settings.maxCommentReads) {
      // Keep the old watermark: the next pass sees the growth and reads it.
      this.summary.commentReadsDeferred += 1;
      this.setWatermark(facts.id, mark);
      return [];
    }
    const thread = await this.fetch<CommentsSnapshot>(commentsScript(facts.id), `comments ${facts.id}`);
    this.summary.commentReads += 1;
    if (thread.unsigned || (thread.ok && thread.comments.length === 0)) {
      // An empty first page for a video with comments is the same refusal in
      // a quieter form. Nothing more is asked for this pass: TikTok answers
      // every list the same way, and each ask is one more unsigned call.
      this.summary.commentsRefused = true;
      this.note(COMMENTS_REFUSED_NOTE);
      this.log("comments_refused", { video: facts.id, status: thread.status, reason: thread.reason, refused: thread.refused });
      this.setWatermark(facts.id, mark);
      return [];
    }
    if (!thread.ok) {
      this.log("thread_failed", { video: facts.id, status: thread.status, reason: thread.reason, refused: thread.refused });
      this.setWatermark(facts.id, mark);
      return [];
    }
    const context = videoContext(facts);
    const items: TikTokItem[] = [];
    for (const raw of thread.comments) {
      const item = commentItem(raw, context, addressedBy(raw.text, this.handle, own));
      if (item) items.push(item);
    }
    this.setWatermark(facts.id, Math.max(count, thread.total ?? 0));
    return items;
  }

  /** keepWatermark follows a video's comment count while its comments are not
   *  read, so turning them on later does not read a backlog as new. */
  private keepWatermark(facts: VideoFacts): void {
    if (facts.partial || facts.comments === undefined) return;
    this.setWatermark(facts.id, facts.comments);
  }

  private setWatermark(id: string, comments: number): void {
    const watch = this.videos[id];
    if (watch) this.videos[id] = { ...watch, commentsRead: comments };
  }

  // --- deciding what is new --------------------------------------------------

  /** consider decides what in one source's items is new, ranks it, and
   *  records the source. The first read of a source is its starting line. */
  private consider(read: SourceRead): void {
    const previous = this.state.sources[read.key];
    const baseline = !previous || previous.filter !== read.filter;
    const since = baseline ? this.at : previous.since;
    const maxAge = this.state.settings.maxItemAgeMs;
    const floor = maxAge > 0 ? Math.max(since, this.at - maxAge) : since;
    const fresh: Match[] = [];
    this.summary.sourcesRead += 1;
    this.summary.itemsRead += read.items.length;

    for (const item of read.items) {
      if (isOwn(item, this.handle)) continue;
      const text = matchText(item);
      const keywords = this.keywords(text);
      if (read.filtered && keywords.length === 0 && !item.addressed) continue;
      if (!item.addressed && this.excluded(text).length > 0) continue;
      const match: Match = { item, source: read.source, keywords, triage: triage(item, { keywords, urgent: this.urgent }) };
      const inWindow = maxAge === 0 || (item.createdAt !== undefined && item.createdAt >= this.at - maxAge);
      if (inWindow && !this.matches.has(item.key)) this.matches.set(item.key, match);
      const isNew = !baseline && !this.seen.has(item.key) && item.createdAt !== undefined && item.createdAt >= floor;
      this.remember(item.key);
      if (isNew) fresh.push(match);
    }

    fresh.sort((left, right) => (left.item.createdAt ?? 0) - (right.item.createdAt ?? 0));
    for (const match of fresh) {
      this.emit({ type: "new_item", at: this.at, ...(this.handle ? { account: this.handle } : {}), ...match });
      if (match.triage.urgency === "high") this.summary.urgent += 1;
    }
    this.summary.newItems += fresh.length;
    if (baseline) this.summary.baselines += 1;
    this.log("source", { source: read.key, baseline, read: read.items.length, fresh: fresh.length });
    this.sources[read.key] = {
      since,
      filter: read.filter,
      lastReadAt: this.at,
      ...(fresh.length > 0 ? { lastNewAt: this.at } : previous?.lastNewAt !== undefined && !baseline ? { lastNewAt: previous.lastNewAt } : {}),
    };
  }

  private sourceFailed(key: string, note: string): void {
    this.note(note);
    this.log("source_failed", { source: key, note });
    const previous = this.state.sources[key];
    if (previous) this.sources[key] = { ...previous, note };
  }

  private remember(key: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.seenOrder.push(key);
  }

  // --- followers -------------------------------------------------------------

  private recordFollowers(handle: string, own: boolean, page: ProfileSnapshot): void {
    if (!this.state.settings.trackFollowers || page.followers === null) return;
    this.summary.followerChecks += 1;
    const key = handle.toLowerCase();
    const previous: FollowerStats = this.state.followers[key] ?? { handle, history: [] };
    const followers = page.followers;
    const next: FollowerStats = {
      handle: page.user?.unique_id || previous.handle || handle,
      followers,
      ...(page.following !== null ? { following: page.following } : {}),
      ...(page.hearts !== null ? { hearts: page.hearts } : {}),
      ...(page.video_count !== null ? { videos: page.video_count } : {}),
      checkedAt: this.at,
      ...(previous.changedAt !== undefined ? { changedAt: previous.changedAt } : {}),
      history: previous.history,
    };
    if (previous.followers === undefined) {
      next.history = [...previous.history, { at: this.at, value: followers }].slice(-MAX_HISTORY);
    } else if (previous.followers !== followers) {
      this.emit({ type: "followers_changed", at: this.at, handle: next.handle, own, previous: previous.followers, current: followers, delta: followers - previous.followers });
      this.summary.followerChanges += 1;
      next.changedAt = this.at;
      next.history = [...previous.history, { at: this.at, value: followers }].slice(-MAX_HISTORY);
    }
    this.state = { ...this.state, followers: { ...this.state.followers, [key]: next } };
  }

  // --- plumbing --------------------------------------------------------------

  /** fetch runs one request script, paced like a person moving between pages,
   *  and turns what would end the pass — a captcha, a rate limit, an
   *  unreachable site — into the matching error. */
  private async fetch<T extends FetchMeta>(script: string, label: string): Promise<T> {
    this.checkStop();
    if (this.summary.requests + this.summary.pageLoads > 0) await this.sleep(this.pause(1500, 4000));
    this.checkStop();
    const started = this.now();
    const result = await this.browser.evaluate<T>(script, label);
    this.summary.requests += 1;
    this.log("request", {
      label,
      path: result.path,
      status: result.status,
      ok: result.ok,
      ms: this.now() - started,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.refused ? { refused: result.refused } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.captcha ? { captcha: true } : {}),
      ...(result.throttled ? { throttled: true } : {}),
    });
    if (result.captcha) throw new SecurityCheck();
    if (result.throttled) {
      throw new RateLimited(`TikTok is limiting this profile (HTTP ${result.status}${result.reason ? `, "${result.reason}"` : ""}). The pass stopped; the next one waits longer.`);
    }
    if (result.status === 0 && result.error) throw new Blocked(`tiktok.com could not be reached (${result.error}).`);
    return result;
  }

  /** finish settles the sources, the watched videos and the seen list. A
   *  source that is no longer configured is forgotten, so adding it back
   *  starts a fresh baseline. */
  private finish(): void {
    const deferred = this.summary.commentReadsDeferred;
    if (deferred > 0) this.note(`${deferred} video${deferred === 1 ? "" : "s"} with new comments wait${deferred === 1 ? "s" : ""} for the next pass (maxCommentReads).`);
    const partial = this.summary.partialVideos;
    if (partial > 0) this.note(`TikTok served no data for ${partial} video page${partial === 1 ? "" : "s"}; their counts are the grid's rounded views until a later pass reads them.`);
    const sources: Record<string, SourceState> = {};
    for (const [key, value] of Object.entries(this.state.sources)) {
      if (this.planned.has(key) || this.stillConfigured(key)) sources[key] = value;
    }
    Object.assign(sources, this.sources);
    const watched = new Set(this.state.settings.creators.map((handle) => handle.toLowerCase()));
    const own = (this.handle || this.state.account?.handle || "").toLowerCase();
    const followers = Object.fromEntries(Object.entries(this.state.followers).filter(([key]) => watched.has(key) || key === own));
    const videos = Object.fromEntries(
      Object.entries(this.videos)
        .filter(([, watch]) => watched.has(watch.handle.toLowerCase()) || watch.handle.toLowerCase() === own)
        .sort(([, left], [, right]) => left.checkedAt - right.checkedAt)
        .slice(-MAX_VIDEOS_WATCHED),
    );
    this.state = {
      ...this.state,
      sources,
      videos,
      followers,
      seen: this.seenOrder.slice(-MAX_SEEN),
      lastPass: {
        at: this.at,
        finishedAt: this.now(),
        newItems: this.summary.newItems,
        urgent: this.summary.urgent,
        followerChanges: this.summary.followerChanges,
        engagementChanges: this.summary.engagementChanges,
        notes: this.summary.notes,
      },
    };
  }

  /** stillConfigured tells a source the settings still ask for, for a pass
   *  that ended before it reached it, or one that is signed out. */
  private stillConfigured(key: string): boolean {
    const settings = this.state.settings;
    if (key === "comments:own") return settings.watchOwnVideos && settings.watchComments;
    const creator = /^creator:([^:]+):(videos|comments)$/.exec(key);
    if (!creator) return false;
    if (creator[2] === "comments" && !settings.watchComments) return false;
    return settings.creators.some((handle) => handle.toLowerCase() === creator[1]);
  }

  /** park leaves the tab on a blank page. It is best effort. */
  private async park(): Promise<void> {
    if (!this.state.settings.parkTab) return;
    try {
      await this.browser.open(BLANK_PAGE);
    } catch (error) {
      this.log("park_failed", { error: errorText(error) });
    }
  }

  private pause(min: number, max: number): number {
    return Math.round(min + (max - min) * this.random());
  }

  private emit(event: MonitorEvent): void {
    this.events.push(event);
    this.log("event", { event });
    try {
      this.deps.onEvent?.(event);
    } catch (error) {
      this.log("on_event_failed", { error: errorText(error) });
    }
  }

  private step(step: string): void {
    this.log("step", { step });
    try {
      this.deps.onStep?.(step);
    } catch {
      /* a status line is not worth a pass */
    }
  }

  private note(note: string): void {
    if (this.summary.notes.includes(note)) return;
    this.summary.notes = [...this.summary.notes, note].slice(-MAX_PASS_NOTES);
  }

  private checkStop(): void {
    if (this.deps.shouldStop?.()) throw new StopRequested("stopped");
  }
}

/** newest takes a grid's newest videos by when they were posted, read from
 *  their ids. The grid lists pinned videos first, and a video pinned a year
 *  ago is not where new comments are. */
function newest(videos: RawGridVideo[], count: number): RawGridVideo[] {
  return [...videos].sort((left, right) => (videoTime(right.id) ?? 0) - (videoTime(left.id) ?? 0)).slice(0, count);
}

/** gridFacts is what the grid alone says about a video. */
function gridFacts(cell: RawGridVideo, handle: string): VideoFacts {
  const views = parseCount(cell.views_text);
  const createdAt = videoTime(cell.id);
  return {
    id: cell.id,
    author: normalizeHandle(cell.author) || handle,
    desc: cell.alt,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(views ? { views: views.value, viewsApproximate: views.approximate } : {}),
    partial: true,
    ...(cell.pinned ? { pinned: true } : {}),
  };
}

/** detailFacts is what the video's own page says, over what the grid said. */
function detailFacts(raw: RawVideo, grid: VideoFacts): VideoFacts {
  const createdAt = raw.create_time !== null && raw.create_time > 0 ? raw.create_time * 1000 : grid.createdAt;
  return {
    id: raw.id,
    author: normalizeHandle(raw.author) || grid.author,
    desc: raw.desc,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...optional("views", raw.views ?? undefined),
    ...optional("likes", raw.likes ?? undefined),
    ...optional("comments", raw.comments ?? undefined),
    ...optional("shares", raw.shares ?? undefined),
    ...optional("saves", raw.saves ?? undefined),
    partial: false,
    ...(grid.pinned ? { pinned: true } : {}),
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
