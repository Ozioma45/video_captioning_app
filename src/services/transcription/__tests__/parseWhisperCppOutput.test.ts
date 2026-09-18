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
});
