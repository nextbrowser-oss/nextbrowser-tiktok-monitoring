// Keyword matching: which of the configured terms an item names.
//
// Every video description and comment, whichever source it came from, is
// matched here the same way. A keyword matches as a whole word or phrase,
// case-insensitively, in any script: "next" is not found in "nextbrowser",
// "nextbrowser" is found in "nextbrowser.com", and a hashtag or a handle
// counts as a word, so "nextbrowser" is found in "#nextbrowser" and
// "@nextbrowser". On TikTok that matters more than anywhere: a description is
// often nothing but hashtags.

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 60;
const MIN_KEYWORD_LENGTH = 2;

/** normalizeKeyword trims a term, drops surrounding quotes and collapses
 *  inner whitespace. It returns "" for anything too short or too long to be a
 *  useful term. */
export function normalizeKeyword(value: unknown): string {
  const text = String(value ?? "")
    .replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, "")
    .replace(/\s+/g, " ");
  if (text.length < MIN_KEYWORD_LENGTH || text.length > MAX_KEYWORD_LENGTH) return "";
  return text;
}

/** normalizeKeywords normalizes a list, drops duplicates regardless of case,
 *  and keeps at most `max`. */
export function normalizeKeywords(values: unknown, max = MAX_KEYWORDS): string[] {
  const out: string[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const keyword = normalizeKeyword(value);
    if (keyword && !out.some((known) => known.toLowerCase() === keyword.toLowerCase())) out.push(keyword);
    if (out.length >= max) break;
  }
  return out;
}

/** splitKeywords reads a comma- or newline-separated list, as a person types
 *  one. Phrases keep their spaces. */
export function splitKeywords(text: string): string[] {
  return text.split(/[,\n]+/).map(normalizeKeyword).filter(Boolean);
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** keywordPattern builds the expression one keyword is found with. The word
 *  boundary is only asked for on a side that is itself a word character, so
 *  "c++" and ".net" still match. */
export function keywordPattern(keyword: string): RegExp {
  const body = keyword.split(" ").map(escape).join("\\s+");
  const before = WORD_CHAR.test(keyword[0] ?? "") ? "(?<![\\p{L}\\p{N}_])" : "";
  const after = WORD_CHAR.test(keyword[keyword.length - 1] ?? "") ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(`${before}${body}${after}`, "iu");
}

export type Matcher = (text: string) => string[];

/** keywordMatcher returns the keywords a text names, in configuration order. */
export function keywordMatcher(keywords: string[]): Matcher {
  const patterns = keywords.map((keyword) => ({ keyword, pattern: keywordPattern(keyword) }));
  return (text) => (text ? patterns.filter(({ pattern }) => pattern.test(text)).map(({ keyword }) => keyword) : []);
}

/** signature names a keyword set independently of order and case, so a
 *  source can tell that what it filters for has changed. */
export function signature(keywords: string[]): string {
  return keywords.map((keyword) => keyword.toLowerCase()).sort().join("|");
}
