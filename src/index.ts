// @nextbrowser-oss/tiktok-monitoring — the browser-agnostic core.
//
// Nothing exported from here touches Node: the Nextbrowser app runs it in the
// renderer with its own nextctl-backed browser. The Node adapter (nbc CLI,
// state file, command line) is "@nextbrowser-oss/tiktok-monitoring/node".

export type { MonitorBrowser } from "./browser.js";
export {
  checkAccount,
  runPass,
  READY_WAIT_MS,
  type AccountCheck,
  type PassDeps,
  type PassResult,
  type PassSummary,
} from "./engine.js";
export type {
  AccountChangedEvent,
  EngagementChangedEvent,
  EngagementMetric,
  FollowersChangedEvent,
  ItemSource,
  Match,
  MonitorEvent,
  NewItemEvent,
  SecurityCheckEvent,
  SignedInEvent,
  SignedOutEvent,
} from "./events.js";
export {
  defaultSettings,
  defaultThresholds,
  emptyState,
  normalizeHandle,
  normalizeSettings,
  normalizeState,
  withSettings,
  MAX_CREATORS,
  type AccountState,
  type CountSample,
  type EngagementThresholds,
  type FollowerStats,
  type MonitorSettings,
  type MonitorState,
  type PassRecord,
  type SettingsPatch,
  type SourceState,
  type VideoWatch,
} from "./state.js";
export {
  addressedBy,
  commentItem,
  mentions,
  videoContext,
  videoItem,
  type Addressed,
  type ItemKind,
  type TikTokItem,
  type VideoContext,
  type VideoFacts,
} from "./items.js";
export { keywordMatcher, normalizeKeyword, normalizeKeywords, splitKeywords, MAX_KEYWORDS } from "./keywords.js";
export { byUrgency, triage, DEFAULT_URGENT_TERMS, type Triage, type Urgency } from "./triage.js";
export { commentUrl, creatorUrl, videoId, videoTime, videoUrl } from "./ids.js";
export { compactCount, parseCount, type ParsedCount } from "./counts.js";
export { LANDING_URL, SIGN_IN_URL } from "./scripts.js";
export type { LogEntry, LogSink } from "./log.js";
export { scheduleDelay, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS } from "./schedule.js";
