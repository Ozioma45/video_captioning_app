import { describe, expect, it } from "vitest";

import type { CaptionWord, SegmentationRules } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "../segmentationRules";
import { segmentCaptions } from "../segmentCaptions";

let nextId = 0;
function word(text: string, startTime: number, endTime: number): CaptionWord {
  nextId += 1;
  return { id: `w${nextId}`, text, startTime, endTime };
}

describe("segmentCaptions", () => {
  it("returns an empty array for empty input", () => {
    expect(segmentCaptions([])).toEqual([]);
  });

  it("keeps a normal short sentence as one segment", () => {
    const words = [
      word("Welcome", 0, 0.5),
      word("to", 0.5, 0.7),
      word("my", 0.7, 0.9),
      word("channel", 0.9, 1.4),
    ];
    const segments = segmentCaptions(words, DEFAULT_SEGMENTATION_RULES);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Welcome to my channel");
    expect(segments[0].words).toHaveLength(4);
    expect(segments[0].startTime).toBe(0);
    expect(segments[0].endTime).toBe(1.4);
  });

  it("breaks a long sentence once the max word count is exceeded", () => {
    const rules: SegmentationRules = { ...DEFAULT_SEGMENTATION_RULES, maxWordsPerSegment: 3, maxCharsPerLine: 1000 };
    const words = Array.from({ length: 7 }, (_, i) => word(`w${i}`, i, i + 0.5));
    const segments = segmentCaptions(words, rules);

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.words.length).toBeLessThanOrEqual(3);
    }
    // every word appears exactly once, in order
    expect(segments.flatMap((s) => s.words.map((w) => w.text))).toEqual(words.map((w) => w.text));
  });

  it("breaks when the maximum character count would be exceeded", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      maxWordsPerSegment: 100,
      maxCharsPerLine: 10,
      maxLines: 1,
      maxSegmentDurationSeconds: 1000,
    };
    const words = [word("aaaaaaaaaa", 0, 1), word("bbbbbbbbbb", 1, 2), word("cccccccccc", 2, 3)];
    const segments = segmentCaptions(words, rules);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(10);
    }
  });

  it("breaks when the maximum segment duration would be exceeded", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      maxWordsPerSegment: 100,
      maxCharsPerLine: 1000,
      maxSegmentDurationSeconds: 2,
      pauseThresholdSeconds: 1000, // disable pause-based breaking for this test
    };
    const words = [word("a", 0, 1), word("b", 1, 2), word("c", 2, 3), word("d", 3, 4)];
    const segments = segmentCaptions(words, rules);
    for (const segment of segments) {
      expect(segment.endTime - segment.startTime).toBeLessThanOrEqual(2);
    }
    expect(segments.length).toBeGreaterThan(1);
  });

  it("breaks on a natural pause once the minimum duration is met", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      maxWordsPerSegment: 100,
      maxCharsPerLine: 1000,
      maxSegmentDurationSeconds: 1000,
      minSegmentDurationSeconds: 0.5,
      pauseThresholdSeconds: 0.4,
      breakOnPunctuation: false,
    };
    const words = [
      word("Hello", 0, 0.6), // 0.6s duration, meets the 0.5s minimum
      word("there", 2.0, 2.5), // 1.4s gap after "Hello" -> pause boundary
      word("friend", 2.5, 2.9),
    ];
    const segments = segmentCaptions(words, rules);
    expect(segments).toHaveLength(2);
    expect(segments[0].words.map((w) => w.text)).toEqual(["Hello"]);
    expect(segments[1].words.map((w) => w.text)).toEqual(["there", "friend"]);
  });

  it("does not break on a pause if doing so would violate the minimum segment duration", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      maxWordsPerSegment: 100,
      maxCharsPerLine: 1000,
      maxSegmentDurationSeconds: 1000,
      minSegmentDurationSeconds: 5, // deliberately high — the pause below shouldn't be enough
      pauseThresholdSeconds: 0.4,
      breakOnPunctuation: false,
    };
    const words = [word("Hi", 0, 0.2), word("there", 2.0, 2.3)];
    const segments = segmentCaptions(words, rules);
    // The 0.2s buffer never reaches the 5s minimum, so the pause is not honored.
    expect(segments).toHaveLength(1);
    expect(segments[0].words.map((w) => w.text)).toEqual(["Hi", "there"]);
  });

  it("prefers a sentence boundary when breakOnPunctuation is enabled", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      maxWordsPerSegment: 100,
      maxCharsPerLine: 1000,
      maxSegmentDurationSeconds: 1000,
      minSegmentDurationSeconds: 0.1,
      pauseThresholdSeconds: 1000, // disable pause-based breaking
      breakOnPunctuation: true,
    };
    const words = [word("Hello.", 0, 0.5), word("Bye", 0.55, 1)];
    const segments = segmentCaptions(words, rules);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Hello.");
    expect(segments[1].text).toBe("Bye");
  });

  it("generates a stable id for every segment", () => {
    const words = [word("a", 0, 1), word("b", 1, 2)];
    const segments = segmentCaptions(words);
    expect(segments[0].id).toBeTruthy();
    expect(typeof segments[0].id).toBe("string");
  });
});
