import { generateId } from "@/lib/id";
import type { CaptionSegment, CaptionWord, SegmentationRules } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "./segmentationRules";
import { joinWordsAsText } from "./wordsText";

const SENTENCE_END_PATTERN = /[.!?]$/;

function endsSentence(word: CaptionWord): boolean {
  return SENTENCE_END_PATTERN.test(word.text.trim());
}

/**
 * Deterministic, single-pass, greedy segmentation
 * (`CaptionWord[] + SegmentationRules → CaptionSegment[]`) — the pure
 * function ARCHITECTURE.md §7 describes. Predictable and easy to improve
 * later rather than a scoring/NLP system (Phase 4 brief §4): each word is
 * added to the current segment unless a hard limit (word count,
 * character count, max duration) would be exceeded, or a natural
 * boundary (a pause, or a sentence-ending word) is available and the
 * minimum duration has already been met.
 *
 * Not wired into the live transcription pipeline — Phase 3 deliberately
 * keeps whisper.cpp's own segment boundaries for the initial document
 * (PROJECT.md §12). This is available for a future "re-segment" action;
 * see DEVELOPMENT_PLAN.md's Phase 4 notes for why that trigger isn't
 * built yet.
 */
export function segmentCaptions(words: CaptionWord[], rules: SegmentationRules = DEFAULT_SEGMENTATION_RULES): CaptionSegment[] {
  if (words.length === 0) return [];

  const maxChars = rules.maxCharsPerLine * rules.maxLines;
  const segments: CaptionSegment[] = [];
  let buffer: CaptionWord[] = [];

  function bufferDurationSeconds(): number {
    if (buffer.length === 0) return 0;
    return buffer[buffer.length - 1].endTime - buffer[0].startTime;
  }

  function flush() {
    if (buffer.length === 0) return;
    segments.push({
      id: generateId(),
      startTime: buffer[0].startTime,
      endTime: buffer[buffer.length - 1].endTime,
      text: joinWordsAsText(buffer),
      words: buffer,
    });
    buffer = [];
  }

  for (const word of words) {
    if (buffer.length === 0) {
      buffer.push(word);
      continue;
    }

    const previousWord = buffer[buffer.length - 1];
    const gapSeconds = word.startTime - previousWord.endTime;
    const durationIfAdded = word.endTime - buffer[0].startTime;
    const charsIfAdded = joinWordsAsText([...buffer, word]).length;
    const meetsMinDuration = bufferDurationSeconds() >= rules.minSegmentDurationSeconds;

    const hardLimitExceeded =
      buffer.length + 1 > rules.maxWordsPerSegment ||
      charsIfAdded > maxChars ||
      durationIfAdded > rules.maxSegmentDurationSeconds;

    const naturalBoundary =
      meetsMinDuration && (gapSeconds > rules.pauseThresholdSeconds || (rules.breakOnPunctuation && endsSentence(previousWord)));

    if (hardLimitExceeded || naturalBoundary) {
      flush();
    }

    buffer.push(word);
  }

  flush();
  return segments;
}
