import { describe, expect, it } from "vitest";

import { formatCaptionTime, parseCaptionTime } from "../captionTimeFormat";

describe("formatCaptionTime", () => {
  it("formats zero", () => {
    expect(formatCaptionTime(0)).toBe("00:00.00");
  });

  it("formats sub-minute values with centiseconds", () => {
    expect(formatCaptionTime(3.4)).toBe("00:03.40");
  });

  it("formats values past a minute without capping at 59", () => {
    expect(formatCaptionTime(84.75)).toBe("01:24.75");
    expect(formatCaptionTime(723.2)).toBe("12:03.20");
  });

  it("clamps a negative or non-finite value to zero rather than crashing", () => {
    expect(formatCaptionTime(-5)).toBe("00:00.00");
    expect(formatCaptionTime(Number.NaN)).toBe("00:00.00");
  });
});

describe("parseCaptionTime", () => {
  it("round-trips values through format then parse", () => {
    for (const seconds of [0, 3.4, 84.75, 723.2]) {
      expect(parseCaptionTime(formatCaptionTime(seconds))).toBeCloseTo(seconds, 2);
    }
  });

  it("parses without centiseconds", () => {
    expect(parseCaptionTime("01:05")).toBeCloseTo(65, 2);
  });

  it("returns null for garbage input", () => {
    expect(parseCaptionTime("not a time")).toBeNull();
    expect(parseCaptionTime("")).toBeNull();
    expect(parseCaptionTime("1:2:3")).toBeNull();
  });

  it("returns null when seconds are out of range (60+)", () => {
    expect(parseCaptionTime("00:75.00")).toBeNull();
  });
});
