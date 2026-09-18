import { describe, expect, it } from "vitest";

import { validateCaptionTiming } from "../captionTimingValidation";

describe("validateCaptionTiming", () => {
  it("accepts a valid, isolated timing range", () => {
    expect(validateCaptionTiming(1, 2)).toEqual([]);
  });

  it("rejects a negative start time", () => {
    const issues = validateCaptionTiming(-1, 2);
    expect(issues.map((i) => i.code)).toContain("negative_start");
  });

  it("rejects end time equal to or before start time", () => {
    expect(validateCaptionTiming(2, 2).map((i) => i.code)).toContain("invalid_range");
    expect(validateCaptionTiming(2, 1).map((i) => i.code)).toContain("invalid_range");
  });

  it("rejects non-finite timestamps and stops there", () => {
    const issues = validateCaptionTiming(Number.NaN, 2);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("not_finite");
  });

  it("detects an overlap with the previous segment", () => {
    const issues = validateCaptionTiming(1, 3, { previousSegmentEndTime: 1.5 });
    expect(issues.map((i) => i.code)).toContain("overlaps_previous");
  });

  it("detects an overlap with the next segment", () => {
    const issues = validateCaptionTiming(1, 3, { nextSegmentStartTime: 2.5 });
    expect(issues.map((i) => i.code)).toContain("overlaps_next");
  });

  it("does not flag an overlap when the boundary exactly touches (abutting, not overlapping)", () => {
    const issues = validateCaptionTiming(1, 2, { previousSegmentEndTime: 1, nextSegmentStartTime: 2 });
    expect(issues).toEqual([]);
  });

  it("detects a caption extending past the known video duration", () => {
    const issues = validateCaptionTiming(1, 10, { videoDurationSeconds: 5 });
    expect(issues.map((i) => i.code)).toContain("exceeds_video_duration");
  });

  it("skips the video-duration check when it isn't provided", () => {
    expect(validateCaptionTiming(1, 999999)).toEqual([]);
  });

  it("can report multiple simultaneous issues", () => {
    const issues = validateCaptionTiming(-5, -10, { videoDurationSeconds: 5 });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("negative_start");
    expect(codes).toContain("invalid_range");
  });
});
