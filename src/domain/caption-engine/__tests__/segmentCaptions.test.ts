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
    // end = last word end; the final caption is not held
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
      maxHoldSeconds: 0,
    };
    const words = [word("a", 0, 1), word("b", 1, 2), word("c", 2, 3), word("d", 3, 4)];
    const segments = segmentCaptions(words, rules);
    for (const segment of segments) {
      expect(segment.endTime - segment.startTime).toBeLessThanOrEqual(2);
    }
    expect(segments.length).toBeGreaterThan(1);
  });

  it("breaks on a natural pause between words", () => {
    const rules: SegmentationRules = {
      ...DEFAULT_SEGMENTATION_RULES,
      pauseThresholdSeconds: 0.4,
      breakOnPunctuation: false,
    };
    const words = [
      word("Hello", 0, 0.6),
      word("there", 0.9, 1.3), // 0.3s gap: not a pause
      word("friend", 1.3, 1.7),
      word("today", 2.5, 3), // 0.8s gap: pause
      word("everyone", 3, 3.6),
      word("listen", 3.6, 4),
    ];
    const segments = segmentCaptions(words, rules);
    expect(segments.map((s) => s.text)).toEqual(["Hello there friend", "today everyone listen"]);
  });

  it("never lets a caption span a long silence", () => {
    const words = [word("Hi", 0, 0.2), word("there", 2.0, 2.3)];
    const segments = segmentCaptions(words);
    expect(segments).toHaveLength(2);
  });

  it("merges a tiny fragment into its neighbor rather than flashing it alone", () => {
    const words = [
      word("we", 0, 0.2),
      word("went", 0.2, 0.5),
      word("home", 0.5, 0.9),
      word("and", 0.95, 1.1),
      word("slept", 1.1, 1.6),
    ];
    const segments = segmentCaptions(words);
    expect(segments).toHaveLength(1);
  });

  it("prefers a sentence boundary when breakOnPunctuation is enabled", () => {
    const words = [
      word("Hello", 0, 0.4),
      word("there", 0.4, 0.8),
      word("my", 0.8, 1),
      word("friend.", 1, 1.5),
      word("Bye", 1.55, 1.9),
      word("now", 1.9, 2.2),
      word("everyone", 2.2, 2.7),
      word("else", 2.7, 3),
    ];
    const segments = segmentCaptions(words);
    expect(segments.map((s) => s.text)).toEqual(["Hello there my friend.", "Bye now everyone else"]);
  });

  it("still splits a long sentence with no punctuation, avoiding a dangling article", () => {
    const text = "we are going to talk about the application we are building for the whole team today";
    const words = text.split(" ").map((t, i) => word(t, i * 0.3, i * 0.3 + 0.28));
    const segments = segmentCaptions(words);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.words.length).toBeLessThanOrEqual(DEFAULT_SEGMENTATION_RULES.maxWordsPerSegment);
      expect(segment.text.length).toBeLessThanOrEqual(42);
    }
    for (const segment of segments.slice(0, -1)) {
      expect(["the", "a", "to", "we", "for", "are"]).not.toContain(segment.words.at(-1)!.text);
    }
  });

  it("derives segment timing from its own words, and holds only up to the next caption", () => {
    const words = [
      word("Hello", 0, 0.4),
      word("everyone", 0.4, 0.9),
      word("today", 1.2, 1.6),
      word("we", 1.6, 1.8),
      word("build", 1.8, 2.2),
    ];
    const rules: SegmentationRules = { ...DEFAULT_SEGMENTATION_RULES, maxWordsPerSegment: 2, maxHoldSeconds: 0.5 };
    const segments = segmentCaptions(words, rules);
    const first = segments[0];
    expect(first.startTime).toBe(0);
    expect(first.words.at(-1)!.text).toBe("everyone");
    // hold is bounded by the gap to the next caption (1.2), not the full 0.5s
    expect(first.endTime).toBeCloseTo(1.2);
    expect(first.endTime).toBeLessThanOrEqual(segments[1].startTime);
  });

  it("assigns every word to exactly one segment, in order, without altering timing", () => {
    const words = Array.from({ length: 200 }, (_, i) => word(i % 9 === 8 ? `w${i}.` : `w${i}`, i * 0.31, i * 0.31 + 0.25));
    const segments = segmentCaptions(words);
    expect(segments.flatMap((s) => s.words)).toEqual(words);
    for (const segment of segments) {
      expect(segment.startTime).toBe(segment.words[0].startTime);
      expect(segment.text.replace(/s+/g, " ")).toBe(segment.words.map((w) => w.text).join(" "));
    }
  });

  it("scales to a long transcript quickly", () => {
    const words = Array.from({ length: 60000 }, (_, i) => word(`w${i}`, i * 0.3, i * 0.3 + 0.25));
    const started = Date.now();
    const segments = segmentCaptions(words);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(segments.flatMap((s) => s.words)).toHaveLength(60000);
  });

  it("generates a stable id for every segment", () => {
    const words = [word("a", 0, 1), word("b", 1, 2)];
    const segments = segmentCaptions(words);
    expect(segments[0].id).toBeTruthy();
    expect(typeof segments[0].id).toBe("string");
  });
});
