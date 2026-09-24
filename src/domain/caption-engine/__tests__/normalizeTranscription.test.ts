import { describe, expect, it } from "vitest";

import type { TranscriptionResult } from "@/types";
import { InsufficientTimestampDataError } from "../errors";
import { normalizeTranscription } from "../normalizeTranscription";

const videoId = "11111111-1111-4111-8111-111111111111";

describe("normalizeTranscription", () => {
  it("preserves word-level timing from the provider result", () => {
    const result: TranscriptionResult = {
      language: "en",
      segments: [
        {
          start: 0,
          end: 1.55,
          text: "Welcome to my channel",
          words: [
            { text: "Welcome", start: 0.2, end: 0.75 },
            { text: "to", start: 0.76, end: 0.9 },
            { text: "my", start: 0.91, end: 1.05 },
            { text: "channel", start: 1.06, end: 1.55 },
          ],
        },
      ],
    };

    const document = normalizeTranscription(videoId, result);

    expect(document.videoId).toBe(videoId);
    expect(document.language).toBe("en");
    expect(document.segments).toHaveLength(1);
    expect(document.segments[0].words).toHaveLength(4);
    expect(document.originalWords).toHaveLength(4);
    expect(document.originalWords.map((w) => w.text)).toEqual(["Welcome", "to", "my", "channel"]);
    for (const word of document.originalWords) {
      expect(word.approximate).toBeUndefined();
      expect(word.endTime).toBeGreaterThan(word.startTime);
    }
  });

  it("builds captions from the flattened words, not from the provider's segments", () => {
    const result: TranscriptionResult = {
      language: "en",
      segments: [
        { start: 0, end: 30, text: "Hello there. World again.", words: [
          { text: "Hello", start: 0, end: 0.5 },
          { text: "there.", start: 0.5, end: 1 },
          { text: "World", start: 1.1, end: 1.5 },
          { text: "again.", start: 1.5, end: 2 },
        ] },
      ],
    };

    const document = normalizeTranscription(videoId, result);
    // provider segment 0-30s must not become a 30 s caption
    for (const segment of document.segments) {
      expect(segment.endTime).toBeLessThan(5);
      expect(segment.startTime).toBe(segment.words[0].startTime);
    }
    expect(document.segments.flatMap((s) => s.words.map((w) => w.text))).toEqual(["Hello", "there.", "World", "again."]);
    expect(document.originalWords.map((w) => w.text)).toEqual(["Hello", "there.", "World", "again."]);
  });

  it("interpolates approximate word timing when a segment has text but no word breakdown", () => {
    const result: TranscriptionResult = {
      language: "en",
      segments: [{ start: 10, end: 12, text: "two words", words: [] }],
    };

    const document = normalizeTranscription(videoId, result);
    const words = document.segments[0].words;

    expect(words.map((w) => w.text)).toEqual(["two", "words"]);
    for (const word of words) {
      expect(word.approximate).toBe(true);
      expect(word.startTime).toBeGreaterThanOrEqual(10);
      expect(word.endTime).toBeLessThanOrEqual(12);
    }
  });

  it("throws InsufficientTimestampDataError when there are no segments at all", () => {
    expect(() => normalizeTranscription(videoId, { language: "en", segments: [] })).toThrow(
      InsufficientTimestampDataError,
    );
  });

  it("throws InsufficientTimestampDataError when segments exist but none yield any words", () => {
    const result: TranscriptionResult = {
      language: "en",
      segments: [{ start: 0, end: 1, text: "", words: [] }],
    };
    expect(() => normalizeTranscription(videoId, result)).toThrow(InsufficientTimestampDataError);
  });

  it("carries a default segmentation-rules descriptor without applying any segmentation logic", () => {
    const result: TranscriptionResult = {
      language: "en",
      segments: [{ start: 0, end: 1, text: "hi", words: [{ text: "hi", start: 0, end: 1 }] }],
    };
    const document = normalizeTranscription(videoId, result);
    expect(document.segmentationRules).toBeDefined();
    expect(document.segments).toHaveLength(1);
  });
});
