import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseWhisperCppOutput } from "@/services/transcription/parseWhisperCppOutput";
import { normalizeTranscription } from "../normalizeTranscription";
import { DEFAULT_SEGMENTATION_RULES } from "../segmentationRules";

/**
 * Real whisper.cpp output (tiny.en, `-ojf`, no `-nt`) for a ~40 s
 * text-to-speech recording with sentences, commas, deliberate pauses and a
 * one-word sentence ("Yes."). Captured 2026-09-24; only the fields the
 * parser reads are kept.
 */
function load(name: string) {
  const raw = JSON.parse(readFileSync(new URL(`../../../services/transcription/__tests__/fixtures/${name}`, import.meta.url), "utf-8"));
  return normalizeTranscription("video-1", parseWhisperCppOutput(raw));
}

const R = DEFAULT_SEGMENTATION_RULES;
const SENTENCE_END = /[.!?]$/;

describe("segmentation quality on real whisper.cpp output", () => {
  const doc = load("whisper-cpp-speech-40s.json");
  const segments = doc.segments;

  it("prints nothing surprising: a reasonable number of short captions", () => {
    // ~39 s of speech, ~95 words → roughly 12–20 captions
    expect(segments.length).toBeGreaterThanOrEqual(11);
    expect(segments.length).toBeLessThanOrEqual(24);
  });

  it("respects the word / character / duration limits", () => {
    for (const s of segments) {
      expect(s.words.length).toBeLessThanOrEqual(R.maxWordsPerSegment);
      expect(s.text.length).toBeLessThanOrEqual(R.maxCharsPerLine * R.maxLines);
      const spoken = s.words.at(-1)!.endTime - s.words[0].startTime;
      expect(spoken).toBeLessThanOrEqual(R.maxSegmentDurationSeconds);
    }
  });

  it("starts and ends each caption at its own words (plus a bounded hold)", () => {
    segments.forEach((s, i) => {
      expect(s.startTime).toBe(s.words[0].startTime);
      const lastEnd = s.words.at(-1)!.endTime;
      expect(s.endTime).toBeGreaterThanOrEqual(lastEnd);
      expect(s.endTime - lastEnd).toBeLessThanOrEqual(R.maxHoldSeconds + 1e-9);
      if (i + 1 < segments.length) expect(s.endTime).toBeLessThanOrEqual(segments[i + 1].startTime + 1e-9);
    });
  });

  it("is ordered, non-overlapping, with non-negative durations", () => {
    for (let i = 0; i < segments.length; i += 1) {
      expect(segments[i].endTime).toBeGreaterThanOrEqual(segments[i].startTime);
      if (i > 0) expect(segments[i].startTime).toBeGreaterThanOrEqual(segments[i - 1].endTime - 1e-9);
    }
  });

  it("keeps every word exactly once, in order, with unchanged timing", () => {
    const out = segments.flatMap((s) => s.words);
    expect(out).toHaveLength(doc.originalWords.length);
    expect(out.map((w) => w.id)).toEqual(doc.originalWords.map((w) => w.id));
    expect(new Set(out.map((w) => w.id)).size).toBe(out.length);
    expect(out).toEqual(doc.originalWords);
  });

  it("keeps text consistent with its words", () => {
    for (const s of segments) expect(s.text).toBe(s.words.map((w) => w.text).join(" "));
  });

  it("breaks at every sentence end, except that a one-word sentence (\"Yes.\") may be folded into its neighbor", () => {
    const segmentEnds = new Set(segments.slice(0, -1).map((seg) => seg.words.at(-1)!.id));
    let wordsInSentence = 0;
    const missed: string[] = [];
    doc.originalWords.forEach((w, i) => {
      wordsInSentence += 1;
      if (SENTENCE_END.test(w.text) && i < doc.originalWords.length - 1) {
        if (wordsInSentence > 1 && !segmentEnds.has(w.id)) missed.push(w.text);
        wordsInSentence = 0;
      }
    });
    expect(missed).toEqual([]);
  });

  it("never spans a long silence or ends on a dangling article/preposition", () => {
    for (const s of segments) {
      for (let i = 1; i < s.words.length; i += 1) {
        expect(s.words[i].startTime - s.words[i - 1].endTime).toBeLessThanOrEqual(Math.max(1.5, R.pauseThresholdSeconds * 3));
      }
    }
    for (const s of segments.slice(0, -1)) {
      expect(["the", "a", "an", "to", "of", "and", "or", "but"]).not.toContain(s.words.at(-1)!.text.toLowerCase());
    }
  });

  it("produces few single-word captions", () => {
    expect(segments.filter((s) => s.words.length === 1).length).toBeLessThanOrEqual(1);
  });

  it("does not turn whisper's 30 s window segments into display captions (output of the old `-nt` flag)", () => {
    const old = load("whisper-cpp-speech-40s-with-nt-flag.json");
    expect(old.segments.length).toBeGreaterThan(8);
    for (const s of old.segments) expect(s.words.length).toBeLessThanOrEqual(R.maxWordsPerSegment);
  });
});
