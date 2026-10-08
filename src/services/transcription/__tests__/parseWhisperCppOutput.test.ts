import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MalformedTranscriptionResultError } from "../errors";
import { parseWhisperCppOutput, type WhisperCppOutput } from "../parseWhisperCppOutput";

// Shaped after whisper.cpp's documented `--output-json-full` (`-ojf`)
// output — the mechanism this provider uses for word-level timestamps.
// See parseWhisperCppOutput.ts's doc comment for the source.
const fullOutput: WhisperCppOutput = {
  result: { language: "en" },
  transcription: [
    {
      text: " Welcome to my channel",
      offsets: { from: 0, to: 2500 },
      tokens: [
        { text: " Welcome", offsets: { from: 200, to: 750 } },
        { text: " to", offsets: { from: 760, to: 900 } },
        { text: " my", offsets: { from: 910, to: 1050 } },
        { text: " channel", offsets: { from: 1060, to: 1550 } },
        { text: "[_TT_123]", offsets: { from: 1550, to: 1550 } },
      ],
    },
    {
      text: " Today I'm going to show you something",
      offsets: { from: 2600, to: 5200 },
      tokens: [
        { text: " Today", offsets: { from: 2600, to: 2900 } },
        { text: " I'm", offsets: { from: 2910, to: 3050 } },
      ],
    },
  ],
};

describe("parseWhisperCppOutput", () => {
  it("maps segments and words with second-based timestamps", () => {
    const result = parseWhisperCppOutput(fullOutput);

    expect(result.language).toBe("en");
    expect(result.segments).toHaveLength(2);

    const first = result.segments[0];
    expect(first.start).toBeCloseTo(0);
    expect(first.end).toBeCloseTo(2.5);
    expect(first.text).toBe("Welcome to my channel");
    expect(first.words.map((w) => w.text)).toEqual(["Welcome", "to", "my", "channel"]);
    expect(first.words[0].start).toBeCloseTo(0.2);
    expect(first.words[0].end).toBeCloseTo(0.75);
  });

  it("filters out whisper.cpp special/control tokens", () => {
    const result = parseWhisperCppOutput(fullOutput);
    const allWords = result.segments.flatMap((s) => s.words.map((w) => w.text));
    expect(allWords).not.toContain("[_TT_123]");
  });

  it("filters out angle-pipe special tokens (e.g. <|endoftext|>) — a real Phase 4 E2E run leaked one", () => {
    // This exact token, at this exact zero-duration position, was
    // observed in a real whisper.cpp run against a ~18s clip on
    // 2026-09-18 — the bracket-style filter above didn't catch it.
    const result = parseWhisperCppOutput({
      result: { language: "en" },
      transcription: [
        {
          text: " Thanks for watching.",
          offsets: { from: 16710, to: 16710 },
          tokens: [
            { text: " Thanks", offsets: { from: 16710, to: 16710 } },
            { text: " for", offsets: { from: 16710, to: 16710 } },
            { text: " watching", offsets: { from: 16710, to: 16710 } },
            { text: ".", offsets: { from: 16710, to: 16710 } },
            { text: "<|endoftext|>", offsets: { from: 30000, to: 30000 } },
          ],
        },
      ],
    });
    const allWords = result.segments.flatMap((s) => s.words.map((w) => w.text));
    expect(allWords).not.toContain("<|endoftext|>");
    expect(allWords).toEqual(["Thanks", "for", "watching."]);
  });

  it("throws MalformedTranscriptionResultError when the transcription array is missing", () => {
    expect(() => parseWhisperCppOutput({ result: { language: "en" } })).toThrow(MalformedTranscriptionResultError);
  });

  it("throws MalformedTranscriptionResultError when transcription is empty", () => {
    expect(() => parseWhisperCppOutput({ result: { language: "en" }, transcription: [] })).toThrow(
      MalformedTranscriptionResultError,
    );
  });

  it("throws MalformedTranscriptionResultError for a segment with neither text nor tokens", () => {
    const malformed: WhisperCppOutput = {
      result: { language: "en" },
      transcription: [{ text: "", offsets: { from: 0, to: 100 }, tokens: [] }],
    };
    expect(() => parseWhisperCppOutput(malformed)).toThrow(MalformedTranscriptionResultError);
  });

  it("defaults language to 'unknown' when absent", () => {
    const result = parseWhisperCppOutput({
      transcription: [{ text: "hi", offsets: { from: 0, to: 100 }, tokens: [{ text: "hi", offsets: { from: 0, to: 100 } }] }],
    });
    expect(result.language).toBe("unknown");
  });

  it("allows a segment with text but no tokens (provider gave only segment-level timing)", () => {
    const result = parseWhisperCppOutput({
      result: { language: "en" },
      transcription: [{ text: "no token breakdown here", offsets: { from: 0, to: 2000 } }],
    });
    expect(result.segments[0].words).toEqual([]);
    expect(result.segments[0].text).toBe("no token breakdown here");
  });

  it("merges sub-word tokens and attached punctuation into whole words (real whisper.cpp output)", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/whisper-cpp-speech-40s.json", import.meta.url), "utf-8"));
    const result = parseWhisperCppOutput(fixture);
    const words = result.segments.flatMap((s) => s.words);
    const texts = words.map((w) => w.text);
    // " tim" + "est" + "amps" + "," is one word, and "capt" + "ions" is one word
    expect(texts).toContain("timestamps,");
    expect(texts).toContain("captions");
    expect(texts).not.toContain("tim");
    expect(texts).not.toContain(",");
    expect(texts).not.toContain(".");
    // attached punctuation must not stretch a word across the following silence
    const video = words.find((w) => w.text === "video.")!;
    expect(video.end).toBeCloseTo(16.28, 2);
  });

  it("corrects a token whose reported end precedes its start, rather than producing an invalid-duration word (real whisper.cpp output)", () => {
    // Captured 2026-10-08 from a real ~17-minute talk, reproduced
    // identically across two separate transcription runs of the same
    // video and a third isolated re-run of just this 600s chunk: right
    // after a ~5s silence, whisper.cpp emitted a run of tokens all
    // anchored to the same (correct) segment-start `from`, each keeping a
    // stale, too-early `to` left over from an earlier decode attempt —
    // until "those" recovers to normal, non-degenerate timing. Left
    // uncorrected, this produced a `CaptionSegment` with `endTime <
    // startTime`, which the export validator correctly rejected with "A
    // caption has invalid timing." — see ARCHITECTURE.md's Export
    // Validation notes for the full trace.
    const result = parseWhisperCppOutput({
      result: { language: "en" },
      transcription: [
        {
          text: " not just their output.",
          offsets: { from: 351430, to: 353040 },
          tokens: [
            { text: " not", offsets: { from: 351430, to: 351650 } },
            { text: " just", offsets: { from: 351650, to: 351950 } },
            { text: " their", offsets: { from: 351950, to: 352320 } },
            { text: " output", offsets: { from: 352320, to: 352770 } },
            { text: ".", offsets: { from: 352770, to: 353030 } },
            { text: "[_TT_404]", offsets: { from: 353040, to: 353040 } },
          ],
        },
        {
          text: " Notice the structural difference between those two approaches.",
          offsets: { from: 358160, to: 362400 },
          tokens: [
            { text: " Notice", offsets: { from: 358160, to: 353880 } },
            { text: " the", offsets: { from: 358160, to: 354300 } },
            { text: " structural", offsets: { from: 358160, to: 355700 } },
            { text: " difference", offsets: { from: 358160, to: 357100 } },
            { text: " between", offsets: { from: 358160, to: 358080 } },
            { text: " those", offsets: { from: 358360, to: 358740 } },
            { text: " two", offsets: { from: 358790, to: 359170 } },
            { text: " approaches", offsets: { from: 359190, to: 360590 } },
            { text: ".", offsets: { from: 360590, to: 361010 } },
            { text: "[_TT_872]", offsets: { from: 361010, to: 361010 } },
          ],
        },
      ],
    });

    const words = result.segments.flatMap((s) => s.words);
    expect(words.map((w) => w.text)).toEqual(["not", "just", "their", "output.", "Notice", "the", "structural", "difference", "between", "those", "two", "approaches."]);

    // The invariant the export validator (and segmentCaptions) depends on: never end before start.
    for (const word of words) expect(word.end).toBeGreaterThanOrEqual(word.start);

    const corrected = words.filter((w) => ["Notice", "the", "structural", "difference", "between"].includes(w.text));
    expect(corrected).toHaveLength(5);
    for (const word of corrected) {
      expect(word.end).toBe(word.start); // collapsed to zero-length, not a fabricated duration
      expect(word.approximate).toBe(true); // flagged, never silently passed off as exact
    }

    // The word immediately following the corrected run had clean timing
    // already and must be left completely alone.
    const those = words.find((w) => w.text === "those")!;
    expect(those).toEqual({ text: "those", start: 358.36, end: 358.74 });
    expect(those.approximate).toBeUndefined();

    // And the segment this produces is exactly what a real `CaptionDocument`
    // would be built from — start must still come from the segment's own
    // first word, never acquire a negative duration.
    const secondSegment = result.segments[1];
    expect(secondSegment.start).toBeCloseTo(358.16, 2);
    expect(secondSegment.words[0]).toEqual({ text: "Notice", start: 358.16, end: 358.16, approximate: true });
  });
});
