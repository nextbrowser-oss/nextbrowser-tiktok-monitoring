// Urgency triage: which of the items a pass found deserve an answer first.
//
// The rules are few, fixed and written out, on purpose: a person deciding
// what to answer first has to be able to see why the monitor put an item on
// top. Every rule adds points and a reason in plain words; the points pick
// the level. No model is involved and nothing leaves the machine.
//
//   mentions the account (@handle), or replies to it                 +4
//   comments on the account's own video                              +2
//   says one of the urgent terms ("refund", "broken", …), when it
//   is about you: addressed to the account or naming a keyword       +3
//   asks a question                                                  +1
//   a comment on your video nobody has replied to yet                +1
//   a video picking up fast since the last look                      +1
//
//   4 or more: high · 2–3: medium · otherwise: low

import { compactCount } from "./counts.js";
import type { Matcher } from "./keywords.js";
import type { TikTokItem } from "./items.js";

export type Urgency = "high" | "medium" | "low";

export interface Triage {
  urgency: Urgency;
  /** The points behind the level, for sorting within a level. */
  score: number;
  /** Why, in plain words, strongest first. */
  reasons: string[];
}

/** Terms that usually mean someone needs an answer soon. The default for the
 *  urgentTerms setting; a team replaces them with its own. */
export const DEFAULT_URGENT_TERMS: readonly string[] = [
  "broken",
  "bug",
  "crash",
  "crashes",
  "crashing",
  "not working",
  "doesn't work",
  "does not work",
  "stopped working",
  "can't log in",
  "cannot log in",
  "refund",
  "charged",
  "scam",
  "fake",
  "hacked",
  "never arrived",
  "never received",
  "wrong order",
  "cancel",
  "urgent",
  "asap",
  "help",
];

const ADDRESSED = {
  mention: { points: 4, text: "Mentions you" },
  reply: { points: 4, text: "Replies to you" },
  comment_on_video: { points: 2, text: "Comments on your video" },
} as const;

/** Question words a comment starts with, in the languages TikTok is busiest
 *  in. A question mark anywhere counts too. */
const QUESTION_START = /^(how|what|why|where|which|who|when|is|are|does|do|did|can|could|should|would|will|has|have|anyone|any|price|link|как|что|почему|где|какой|какая|кто|сколько|есть ли|подскажите|cómo|qué|cuánto|dónde|como|quanto|onde|wie|was|warum|wo|comment|pourquoi|combien|où)(?![\p{L}\p{N}_])/iu;

export interface TriageContext {
  /** The keywords the item named. */
  keywords: string[];
  /** Finds the urgent terms in a text. */
  urgent: Matcher;
}

function asksQuestion(item: TikTokItem): boolean {
  const text = item.text.replace(/^(@[\w.]+\s*)+/, "").trim();
  return text.includes("?") || text.includes("？") || QUESTION_START.test(text);
}

/** triage ranks one item. */
export function triage(item: TikTokItem, context: TriageContext): Triage {
  const reasons: { points: number; text: string }[] = [];
  if (item.addressed) reasons.push(ADDRESSED[item.addressed]);

  // An urgent term only counts where the item is about you. A stranger's
  // "my order never arrived" under a competitor's video is the competitor's
  // problem unless it names one of your keywords.
  const aboutYou = !!item.addressed || context.keywords.length > 0;
  const urgent = aboutYou ? context.urgent(item.text) : [];
  if (urgent.length) reasons.push({ points: 3, text: `Says ${urgent.slice(0, 2).map((term) => `"${term}"`).join(", ")}` });

  if (item.kind === "comment" && asksQuestion(item)) reasons.push({ points: 1, text: "Asks a question" });

  if (item.addressed === "comment_on_video" && item.replies === 0) reasons.push({ points: 1, text: "No reply yet" });

  if (item.kind === "video" && item.viewsGained !== undefined && item.viewsGained > 0) {
    reasons.push({ points: 1, text: `Picking up fast: +${compactCount(item.viewsGained)} views since the last look` });
  }

  const score = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const urgency: Urgency = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { urgency, score, reasons: reasons.sort((a, b) => b.points - a.points).map((reason) => reason.text) };
}

const ORDER: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };

/** byUrgency sorts triaged entries most urgent first, then newest first. */
export function byUrgency<T extends { triage: Triage; item: TikTokItem }>(left: T, right: T): number {
  return ORDER[left.triage.urgency] - ORDER[right.triage.urgency]
    || right.triage.score - left.triage.score
    || (right.item.createdAt ?? 0) - (left.item.createdAt ?? 0);
}
