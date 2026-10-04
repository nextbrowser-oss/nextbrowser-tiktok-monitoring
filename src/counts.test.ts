import { describe, expect, it } from "vitest";
import { compactCount, parseCount } from "./counts.js";

describe("parseCount", () => {
  it.each([
    ["980", 980],
    ["0", 0],
    ["1,234", 1234],
    ["1 234", 1234],
    ["1.234", 1234],
  ])("reads the exact figure in %j", (label, value) => {
    expect(parseCount(label)).toEqual({ value, approximate: false });
  });

  it.each([
    ["12.3K", 12_300],
    ["1.2M", 1_200_000],
    ["1,2 млн", 1_200_000],
    ["533 тыс.", 533_000],
    ["12万", 120_000],
    ["1.1B", 1_100_000_000],
    ["45,6 mil", 45_600],
  ])("reads the rounded figure in %j", (label, value) => {
    expect(parseCount(label)).toEqual({ value, approximate: true });
  });

  it("is undefined for anything that does not start with a figure", () => {
    expect(parseCount("")).toBeUndefined();
    expect(parseCount(undefined)).toBeUndefined();
    expect(parseCount("views")).toBeUndefined();
  });
});

describe("compactCount", () => {
  it("writes a count the way TikTok prints it", () => {
    expect(compactCount(950)).toBe("950");
    expect(compactCount(1250)).toBe("1.3K");
    expect(compactCount(12_400)).toBe("12K");
    expect(compactCount(2_500_000)).toBe("2.5M");
    expect(compactCount(-3000)).toBe("-3K");
  });
});
