// When the next pass should run. The caller owns the timer — the app has its
// own scheduler, the CLI a loop — and this only says how long to wait.

/** The shortest interval between passes. TikTok answers a browser that opens
 *  profile after profile quickly with a captcha, and a profile stuck behind
 *  one reads nothing at all until a person solves it. Ten minutes between
 *  passes keeps a pass looking like someone checking in, not a crawler. */
export const MIN_INTERVAL_MS = 10 * 60_000;
export const DEFAULT_INTERVAL_MS = 30 * 60_000;
/** How far one wait may stray from the interval, either way. */
const JITTER = 0.2;

/** scheduleDelay is the interval with a random spread, never under the
 *  minimum. After a captcha, a rate limit or a refusal the next pass waits
 *  three intervals: asking again at once only earns the next captcha. */
export function scheduleDelay(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  options: { random?: () => number; backOff?: boolean } = {},
): number {
  const random = options.random ?? Math.random;
  const base = Math.max(MIN_INTERVAL_MS, Number.isFinite(intervalMs) ? intervalMs : DEFAULT_INTERVAL_MS);
  const spread = 1 + JITTER * (2 * random() - 1);
  const delay = Math.round(base * spread * (options.backOff ? 3 : 1));
  return Math.max(MIN_INTERVAL_MS, delay);
}
