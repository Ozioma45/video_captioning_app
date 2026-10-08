import { describe, expect, it } from "vitest";

import type { TranscriptionResult, TranscriptionWord } from "@/types";
import { mergeChunkedTranscriptionResults } from "../mergeChunkedTranscription";

const w = (text: string, start: number, end: number): TranscriptionWord => ({ text, start, end });

function result(language: string, segments: TranscriptionResult["segments"]): TranscriptionResult {
  return { language, segments };
}

describe("mergeChunkedTranscriptionResults", () => {
  it("returns an empty result for no chunks", () => {
    expect(mergeChunkedTranscriptionResults([])).toEqual({ language: "unknown", segments: [] });
  });

  it("returns the single chunk unchanged when there is only one chunk at offset 0 (non-chunked path)", () => {
    const single = result("en", [{ text: "hi", start: 0, end: 1, words: [w("hi", 0, 1)] }]);
    expect(mergeChunkedTranscriptionResults([{ result: single, offsetSeconds: 0 }])).toBe(single);
  });

  it("offsets every segment and word's start/end by the chunk's start time, preserving durations exactly", () => {
    const chunk0 = result("en", [{ text: "hello there", start: 0, end: 1.5, words: [w("hello", 0, 0.8), w("there", 0.8, 1.5)] }]);
    const chunk1 = result("en", [{ text: "second chunk", start: 0.2, end: 1, words: [w("second", 0.2, 0.6), w("chunk", 0.6, 1)] }]);

    const merged = mergeChunkedTranscriptionResults([
      { result: chunk0, offsetSeconds: 0 },
      { result: chunk1, offsetSeconds: 600 }, // chunk 1 started at 600s in the original audio
    ]);

    expect(merged.segments).toHaveLength(2);
    expect(merged.segments[0]).toEqual(chunk0.segments[0]); // offset 0: unchanged
    expect(merged.segments[1].start).toBeCloseTo(600.2, 6);
    expect(merged.segments[1].end).toBeCloseTo(601, 6);
    expect(merged.segments[1].words[0]).toEqual({ text: "second", start: 600.2, end: 600.6 });
    expect(merged.segments[1].words[1]).toEqual({ text: "chunk", start: 600.6, end: 601 });
  });

  it("keeps segments and words in chunk order, with no word lost, duplicated, or reordered", () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      result("en", [{ text: `word${i}`, start: 0, end: 1, words: [w(`word${i}`, 0, 1)] }]),
    );
    const merged = mergeChunkedTranscriptionResults(chunks.map((result, i) => ({ result, offsetSeconds: i * 600 })));
    expect(merged.segments.map((s) => s.text)).toEqual(["word0", "word1", "word2", "word3", "word4"]);
    const allWords = merged.segments.flatMap((s) => s.words);
    expect(allWords).toHaveLength(5);
    expect(allWords.map((w) => w.start)).toEqual([0, 600, 1200, 1800, 2400]);
  });

  it("preserves the approximate flag on words that carry one", () => {
    const chunk = result("en", [{ text: "x", start: 0, end: 1, words: [{ text: "x", start: 0, end: 1, approximate: true }] }]);
    const merged = mergeChunkedTranscriptionResults([{ result: chunk, offsetSeconds: 300 }]);
    expect(merged.segments[0].words[0]).toEqual({ text: "x", start: 300, end: 301, approximate: true });
  });

  it("uses the first chunk's language for the merged result", () => {
    const merged = mergeChunkedTranscriptionResults([
      { result: result("en", [{ text: "a", start: 0, end: 1, words: [w("a", 0, 1)] }]), offsetSeconds: 0 },
      { result: result("en", [{ text: "b", start: 0, end: 1, words: [w("b", 0, 1)] }]), offsetSeconds: 600 },
    ]);
    expect(merged.language).toBe("en");
  });

  it("handles a chunk with no segments (e.g. a silent tail chunk) without dropping the others", () => {
    const merged = mergeChunkedTranscriptionResults([
      { result: result("en", [{ text: "a", start: 0, end: 1, words: [w("a", 0, 1)] }]), offsetSeconds: 0 },
      { result: result("en", []), offsetSeconds: 600 },
      { result: result("en", [{ text: "c", start: 0, end: 1, words: [w("c", 0, 1)] }]), offsetSeconds: 1200 },
    ]);
    expect(merged.segments.map((s) => s.text)).toEqual(["a", "c"]);
  });

  it("does not mutate the input chunk results", () => {
    const chunk = result("en", [{ text: "x", start: 0, end: 1, words: [w("x", 0, 1)] }]);
    const copy = JSON.parse(JSON.stringify(chunk));
    mergeChunkedTranscriptionResults([{ result: chunk, offsetSeconds: 500 }]);
    expect(chunk).toEqual(copy);
  });
});
