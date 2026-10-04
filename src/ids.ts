// TikTok ids and links.
//
// Video, comment and user ids are 19-digit numbers, wider than a JavaScript
// number can hold exactly, so they are kept as digit strings and never parsed
// into a Number; the page scripts quote them before JSON.parse sees them.
//
// A video id is not random: its top 32 bits are the second the video was
// posted. That gives every video a time even when its page says nothing else,
// and it lets the newest videos of a grid be picked without opening any of
// them — the grid lists pinned videos first, whatever their age.

const DIGITS = /^\d{1,25}$/;
/** Ids that decode to a time before this were not issued with a timestamp in
 *  them, or are not video ids at all. TikTok's web app went live in 2017. */
const EARLIEST_MS = Date.UTC(2014, 0, 1);

/** videoId reads a video id: the digits, without leading zeros. Anything that
 *  is not an id returns "". */
export function videoId(id: unknown): string {
  const text = String(id ?? "").trim();
  return DIGITS.test(text) ? text.replace(/^0+(?=\d)/, "") : "";
}

/** videoTime is when a video was posted, read from its id, in milliseconds
 *  since the epoch; undefined for an id that does not carry a plausible time. */
export function videoTime(id: unknown): number | undefined {
  const digits = videoId(id);
  if (!digits) return undefined;
  const seconds = Number(BigInt(digits) >> 32n);
  const ms = seconds * 1000;
  return ms >= EARLIEST_MS ? ms : undefined;
}

/** creatorUrl is the link to a creator's profile. */
export function creatorUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`;
}

/** videoUrl is the link to a video. TikTok accepts any handle in it and
 *  redirects to the video's author, but the right one is used anyway. */
export function videoUrl(handle: string, id: string): string {
  return `https://www.tiktok.com/@${handle}/video/${id}`;
}

/** commentUrl is where a comment is opened. TikTok has no stable link to one
 *  comment — the web app opens a video and its comment panel, never a single
 *  comment — so a comment's link is its video's. */
export function commentUrl(handle: string, video: string): string {
  return videoUrl(handle, video);
}
