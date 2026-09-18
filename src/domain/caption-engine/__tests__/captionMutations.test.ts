import { describe, expect, it } from "vitest";

import type { CaptionDocument, CaptionSegment, CaptionWord } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "../segmentationRules";
import {
  mergeCaptions,
  splitCaption,
  updateCaptionText,
  updateCaptionTiming,
} from "../captionMutations";
import {
  CaptionSegmentNotFoundError,
  InvalidCaptionSplitError,
  InvalidCaptionTimingError,
  SegmentsNotAdjacentError,
} from "../errors";

let nextId = 0;
function word(text: string, startTime: number, endTime: number): CaptionWord {
  nextId += 1;
  return { id: `w${nextId}`, text, startTime, endTime };
}

function buildDocument(segments: CaptionSegment[]): CaptionDocument {
  return {
    id: "doc1",
    videoId: "video1",
    language: "en",
    originalWords: segments.flatMap((s) => s.words),
    segmentationRules: DEFAULT_SEGMENTATION_RULES,
    segments,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function segment(id: string, text: string, words: CaptionWord[]): CaptionSegment {
  return { id, startTime: words[0].startTime, endTime: words[words.length - 1].endTime, text, words };
}

describe("updateCaptionText", () => {
  it("updates the text and marks words stale, leaving timing and words untouched", () => {
    const words = [word("Hello", 0, 0.5), word("world", 0.5, 1)];
    const doc = buildDocument([segment("s1", "Hello world", words)]);

    const updated = updateCaptionText(doc, "s1", "Hi planet");

    expect(updated.segments[0].text).toBe("Hi planet");
    expect(updated.segments[0].wordsStale).toBe(true);
    expect(updated.segments[0].words).toEqual(words); // preserved, not fabricated
    expect(updated.segments[0].startTime).toBe(0);
    expect(updated.segments[0].endTime).toBe(1);
  });

  it("is a no-op (same reference) when the text is unchanged", () => {
    const words = [word("Hello", 0, 0.5)];
    const doc = buildDocument([segment("s1", "Hello", words)]);
    const updated = updateCaptionText(doc, "s1", "Hello");
    expect(updated).toBe(doc);
  });

  it("never touches originalWords", () => {
    const words = [word("Hello", 0, 0.5)];
    const doc = buildDocument([segment("s1", "Hello", words)]);
    const updated = updateCaptionText(doc, "s1", "Goodbye");
    expect(updated.originalWords).toBe(doc.originalWords);
  });

  it("does not change unrelated segments' object identity (re-render performance)", () => {
    const s1 = segment("s1", "one", [word("one", 0, 1)]);
    const s2 = segment("s2", "two", [word("two", 1, 2)]);
    const doc = buildDocument([s1, s2]);

    const updated = updateCaptionText(doc, "s1", "ONE");
    expect(updated.segments[1]).toBe(s2);
    expect(updated.segments[0]).not.toBe(s1);
  });

  it("throws CaptionSegmentNotFoundError for an unknown id", () => {
    const doc = buildDocument([segment("s1", "Hello", [word("Hello", 0, 1)])]);
    expect(() => updateCaptionText(doc, "missing", "x")).toThrow(CaptionSegmentNotFoundError);
  });
});

describe("updateCaptionTiming", () => {
  it("updates start/end time and leaves words untouched", () => {
    const words = [word("Hello", 0, 0.5)];
    const doc = buildDocument([segment("s1", "Hello", words)]);

    const updated = updateCaptionTiming(doc, "s1", 0.2, 1.5);
    expect(updated.segments[0].startTime).toBe(0.2);
    expect(updated.segments[0].endTime).toBe(1.5);
    expect(updated.segments[0].words).toBe(words);
    expect(updated.segments[0].wordsStale).toBeUndefined();
  });

  it("rejects an invalid range and throws InvalidCaptionTimingError", () => {
    const doc = buildDocument([segment("s1", "Hello", [word("Hello", 0, 1)])]);
    expect(() => updateCaptionTiming(doc, "s1", 2, 1)).toThrow(InvalidCaptionTimingError);
  });

  it("rejects a timing change that would overlap the next segment, without touching it", () => {
    const s1 = segment("s1", "one", [word("one", 0, 1)]);
    const s2 = segment("s2", "two", [word("two", 2, 3)]);
    const doc = buildDocument([s1, s2]);

    expect(() => updateCaptionTiming(doc, "s1", 0, 2.5)).toThrow(InvalidCaptionTimingError);
    // Rejected edits never mutate anything (no partial state change).
    expect(doc.segments[0]).toBe(s1);
    expect(doc.segments[1]).toBe(s2);
  });

  it("allows a timing change that abuts but does not overlap a neighbor", () => {
    const s1 = segment("s1", "one", [word("one", 0, 1)]);
    const s2 = segment("s2", "two", [word("two", 2, 3)]);
    const doc = buildDocument([s1, s2]);

    const updated = updateCaptionTiming(doc, "s1", 0, 2);
    expect(updated.segments[0].endTime).toBe(2);
  });
});

describe("splitCaption", () => {
  it("splits at a word boundary, preserving word timestamps on both sides", () => {
    const words = [
      word("Welcome", 0, 0.5),
      word("back", 0.5, 1),
      word("to", 1, 1.3),
      word("the", 1.3, 1.5),
      word("channel", 1.5, 2),
    ];
    const doc = buildDocument([segment("s1", "Welcome back to the channel", words)]);

    const updated = splitCaption(doc, "s1", 2);

    expect(updated.segments).toHaveLength(2);
    const [first, second] = updated.segments;

    expect(first.text).toBe("Welcome back");
    expect(first.words.map((w) => w.text)).toEqual(["Welcome", "back"]);
    expect(first.startTime).toBe(0);
    expect(first.endTime).toBe(1);

    expect(second.text).toBe("to the channel");
    expect(second.words.map((w) => w.text)).toEqual(["to", "the", "channel"]);
    expect(second.startTime).toBe(1);
    expect(second.endTime).toBe(2);
  });

  it("gives the two new segments stable, distinct, freshly generated ids", () => {
    const words = [word("a", 0, 1), word("b", 1, 2)];
    const doc = buildDocument([segment("s1", "a b", words)]);
    const updated = splitCaption(doc, "s1", 1);
    expect(updated.segments[0].id).not.toBe("s1");
    expect(updated.segments[1].id).not.toBe("s1");
    expect(updated.segments[0].id).not.toBe(updated.segments[1].id);
  });

  it("maintains overall segment ordering when splitting a segment in the middle of a document", () => {
    const before = segment("before", "before", [word("before", 0, 1)]);
    const target = segment("target", "a b", [word("a", 1, 2), word("b", 2, 3)]);
    const after = segment("after", "after", [word("after", 3, 4)]);
    const doc = buildDocument([before, target, after]);

    const updated = splitCaption(doc, "target", 1);
    expect(updated.segments).toHaveLength(4);
    expect(updated.segments[0]).toBe(before);
    expect(updated.segments[3]).toBe(after);
  });

  it("falls back to interpolated word boundaries when the segment has no real word data", () => {
    const seg: CaptionSegment = { id: "s1", startTime: 0, endTime: 4, text: "one two three four", words: [] };
    const doc = buildDocument([seg]);

    const updated = splitCaption(doc, "s1", 2);
    expect(updated.segments).toHaveLength(2);
    expect(updated.segments[0].text).toBe("one two");
    expect(updated.segments[1].text).toBe("three four");
    expect(updated.segments[0].words.every((w) => w.approximate)).toBe(true);
  });

  it("rejects a split that would produce a zero-duration half, rather than crashing on degenerate real timestamps", () => {
    // A real Phase 4 E2E run (2026-09-18) against a long, un-segmented
    // whisper.cpp transcript produced many consecutive words sharing the
    // exact same start/end timestamp (a known long-segment alignment
    // artifact). Splitting between two such words must fail cleanly, not
    // corrupt the document or throw an unrelated error.
    const words = [
      word("This", 15.44, 15.68),
      word("is", 16.29, 16.71),
      word("the", 16.71, 16.71),
      word("second", 16.71, 16.71),
      word("topic", 16.71, 16.71),
    ];
    const doc = buildDocument([segment("s1", "This is the second topic", words)]);

    // Splitting so that the second half's first word (16.71) equals the
    // segment's own end time (16.71) would give it zero duration.
    expect(() => splitCaption(doc, "s1", 4)).toThrow(InvalidCaptionSplitError);
  });

  it("rejects a split index outside the valid word range", () => {
    const words = [word("a", 0, 1), word("b", 1, 2)];
    const doc = buildDocument([segment("s1", "a b", words)]);
    expect(() => splitCaption(doc, "s1", 0)).toThrow(InvalidCaptionSplitError);
    expect(() => splitCaption(doc, "s1", 2)).toThrow(InvalidCaptionSplitError);
  });

  it("rejects splitting a single-word segment", () => {
    const doc = buildDocument([segment("s1", "hi", [word("hi", 0, 1)])]);
    expect(() => splitCaption(doc, "s1", 1)).toThrow(InvalidCaptionSplitError);
  });
});

describe("mergeCaptions", () => {
  it("merges two adjacent segments, concatenating words in order", () => {
    const s1 = segment("s1", "Welcome back.", [word("Welcome", 0, 0.5), word("back.", 0.5, 1)]);
    const s2 = segment("s2", "Today we build.", [word("Today", 1.2, 1.6), word("we", 1.6, 1.8), word("build.", 1.8, 2.2)]);
    const doc = buildDocument([s1, s2]);

    const updated = mergeCaptions(doc, "s1", "s2");
    expect(updated.segments).toHaveLength(1);

    const merged = updated.segments[0];
    expect(merged.startTime).toBe(0);
    expect(merged.endTime).toBe(2.2);
    expect(merged.words.map((w) => w.text)).toEqual(["Welcome", "back.", "Today", "we", "build."]);
    expect(merged.text).toBe("Welcome back. Today we build.");
  });

  it("uses the raw edited text (not reconstructed words) when either side was manually edited", () => {
    const s1: CaptionSegment = {
      ...segment("s1", "Manually edited text", [word("Manually", 0, 0.5), word("edited", 0.5, 1)]),
      wordsStale: true,
    };
    const s2 = segment("s2", "Second part", [word("Second", 1, 1.5), word("part", 1.5, 2)]);
    const doc = buildDocument([s1, s2]);

    const updated = mergeCaptions(doc, "s1", "s2");
    expect(updated.segments[0].text).toBe("Manually edited text Second part");
    expect(updated.segments[0].wordsStale).toBe(true);
  });

  it("rejects merging non-adjacent segments", () => {
    const s1 = segment("s1", "one", [word("one", 0, 1)]);
    const s2 = segment("s2", "two", [word("two", 1, 2)]);
    const s3 = segment("s3", "three", [word("three", 2, 3)]);
    const doc = buildDocument([s1, s2, s3]);

    expect(() => mergeCaptions(doc, "s1", "s3")).toThrow(SegmentsNotAdjacentError);
  });

  it("rejects merging in reverse order (second, first)", () => {
    const s1 = segment("s1", "one", [word("one", 0, 1)]);
    const s2 = segment("s2", "two", [word("two", 1, 2)]);
    const doc = buildDocument([s1, s2]);
    expect(() => mergeCaptions(doc, "s2", "s1")).toThrow(SegmentsNotAdjacentError);
  });

  it("preserves segments before and after the merged pair", () => {
    const before = segment("before", "before", [word("before", 0, 1)]);
    const s1 = segment("s1", "one", [word("one", 1, 2)]);
    const s2 = segment("s2", "two", [word("two", 2, 3)]);
    const after = segment("after", "after", [word("after", 3, 4)]);
    const doc = buildDocument([before, s1, s2, after]);

    const updated = mergeCaptions(doc, "s1", "s2");
    expect(updated.segments).toHaveLength(3);
    expect(updated.segments[0]).toBe(before);
    expect(updated.segments[2]).toBe(after);
  });
});
