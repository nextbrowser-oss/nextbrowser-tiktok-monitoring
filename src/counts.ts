// Reading a count the way tiktok.com draws it, and writing one back as short.
//
// A creator's video grid prints each video's view count on its cover: the
// exact number below a thousand, a rounded figure with a unit above it —
// "12.3K", "1.2M", and in the viewer's locale "1,2 млн" or "12万". The video's
// own page carries the exact figures, but when it serves no data the grid's
// figure is all there is. A rounded figure is still worth recording, but a
// change inside its rounding is invisible, so every parse says whether it is
// exact. (The parser is the X monitor's, src/counts.ts there: both sites
// round the same way.)

export interface ParsedCount {
  value: number;
  /** True when the figure was rounded and printed with a unit. */
  approximate: boolean;
}

/** Units across the locales TikTok draws in, by what they multiply.
 *  Lowercased, without the trailing dot some locales abbreviate with. */
const UNITS: Record<string, number> = {
  // thousand
  k: 1e3, "тыс": 1e3, "тис": 1e3, mil: 1e3, "千": 1e3, "천": 1e3, rb: 1e3, tys: 1e3, n: 1e3,
  // ten thousand (CJK)
  "万": 1e4, "萬": 1e4, "만": 1e4,
  // million
  m: 1e6, mln: 1e6, "млн": 1e6, mio: 1e6, mi: 1e6, mn: 1e6, jt: 1e6, tr: 1e6,
  // hundred million (CJK)
  "億": 1e8, "亿": 1e8, "억": 1e8,
  // billion
  b: 1e9, bn: 1e9, mrd: 1e9, "млрд": 1e9, bi: 1e9, md: 1e9,
};

const NUMBER_PATTERN = /^([+-]?\d[\d\s.,'  ]*)(\S*)/u;
const GROUP_SEPARATORS = /[\s'  ]/gu;

/** parseCount reads the leading figure of a label such as "12.3K" or
 *  "1,2 млн". Anything that does not start with a figure is not a count and
 *  returns undefined. */
export function parseCount(label: string | null | undefined): ParsedCount | undefined {
  const firstLine = String(label ?? "").trim().split(/\n/u)[0]?.trim() ?? "";
  const match = NUMBER_PATTERN.exec(firstLine);
  if (!match) return undefined;
  const digits = (match[1] ?? "").replace(GROUP_SEPARATORS, "");
  const unit = (match[2] ?? "").toLowerCase().replace(/\.+$/u, "");
  const multiplier = UNITS[unit];
  if (multiplier === undefined) {
    // No unit: the figure is an exact integer and every separator in it
    // groups thousands, whatever the locale uses for them.
    const whole = digits.replace(/[.,]/gu, "");
    if (!/^[+-]?\d+$/u.test(whole)) return undefined;
    return { value: Number(whole), approximate: false };
  }
  const value = Number(decimal(digits));
  if (!Number.isFinite(value)) return undefined;
  return { value: Math.round(value * multiplier), approximate: true };
}

/** decimal turns "92,3" or "1.2" or "1,234.5" into a JavaScript decimal: with
 *  both separators present the last one is the decimal point; with one kind, a
 *  figure that carries a unit uses it as the decimal point. */
function decimal(digits: string): string {
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  if (lastDot < 0 && lastComma < 0) return digits;
  const point = Math.max(lastDot, lastComma);
  const whole = digits.slice(0, point).replace(/[.,]/gu, "");
  return `${whole}.${digits.slice(point + 1)}`;
}

/** compactCount writes a count the way TikTok would print it, for a reason a
 *  person reads: 950, 1.3K, 12K, 2.5M. */
export function compactCount(value: number): string {
  const sign = value < 0 ? "-" : "";
  const size = Math.abs(Math.round(value));
  if (size < 1000) return `${sign}${size}`;
  for (const [unit, scale] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
    if (size >= scale) {
      const figure = size / scale;
      const text = figure >= 10 ? String(Math.round(figure)) : (Math.round(figure * 10) / 10).toString();
      return `${sign}${text}${unit}`;
    }
  }
  return `${sign}${size}`;
}
