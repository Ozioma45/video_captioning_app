import type { CaptionSegment, CaptionWord } from "@/types";
import { interpolateWordsFromText } from "./interpolateWords";

const PUNCTUATION_ONLY = /^[.,!?;:]+$/;

/**
 * Reconstructs display text from a word list. whisper.cpp's own tokens
 * are already trimmed (see services/transcription/parseWhisperCppOutput.ts),
 * so a naive `words.join(" ")` puts a stray space before punctuation
 * ("Hello , this") — this closes that one specific, cheap, deterministic
 * gap without attempting real detokenization/NLP.
 */
export function joinWordsAsText(words: CaptionWord[]): string {
  let result = "";
  for (const word of words) {
    const isPunctuationOnly = PUNCTUATION_ONLY.test(word.text);
    if (result.length > 0 && !isPunctuationOnly) result += " ";
    result += word.text;
  }
  return result.trim();
}

/**
 * The word list to actually operate on for split/segmentation UI: real
 * per-word timing when present, otherwise an interpolated stand-in
 * derived from the segment's own text/time span (never fabricated out of
 * nothing, always marked `approximate`). Used by both `captionMutations`
 * (so split works even without real word data) and the caption editor UI
 * (so the split word-picker always has *something* to render) — one
 * source of truth instead of the UI re-deriving its own version.
 */
export function getEffectiveWords(segment: CaptionSegment): CaptionWord[] {
  if (segment.words.length > 0) return segment.words;
  return interpolateWordsFromText(segment.text, segment.startTime, segment.endTime);
}
