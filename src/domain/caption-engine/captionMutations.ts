import { generateId } from "@/lib/id";
import type { CaptionDocument, CaptionSegment, CaptionSegmentId } from "@/types";
import {
  CaptionSegmentNotFoundError,
  InvalidCaptionSplitError,
  InvalidCaptionTimingError,
  SegmentsNotAdjacentError,
} from "./errors";
import { validateCaptionTiming, type CaptionTimingContext } from "./captionTimingValidation";
import { getEffectiveWords, joinWordsAsText } from "./wordsText";

/**
 * Pure caption-editing operations (Phase 4 brief §17-18). Every function
 * takes a `CaptionDocument` and returns a new one — nothing here mutates
 * its input, and nothing here touches `originalWords` (the immutable
 * "reset to original transcript" source of truth, per
 * ARCHITECTURE.md §7). Unrelated segments keep their exact object
 * identity across an edit (only the changed index/indices get a new
 * object) so a UI selector like `segments.find(s => s.id === id)` only
 * re-renders the item that actually changed (Phase 4 brief §6, §15).
 */

function findSegmentIndex(document: CaptionDocument, segmentId: CaptionSegmentId): number {
  const index = document.segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) throw new CaptionSegmentNotFoundError(segmentId);
  return index;
}

function touch(document: CaptionDocument, segments: CaptionSegment[]): CaptionDocument {
  return { ...document, segments, updatedAt: new Date().toISOString() };
}

/**
 * Updates a segment's text. Timing and word data are left exactly as
 * they were — but any change marks `wordsStale: true`, since the edited
 * text may no longer correspond word-for-word to the preserved `words`
 * (Phase 4 brief §12). This is deliberately blunt (any change, not just
 * a "substantial" one) rather than attempting to detect how much the
 * text changed — a simple, predictable, always-correct-to-be-cautious
 * rule beats a heuristic that could misjudge and claim false confidence.
 */
export function updateCaptionText(document: CaptionDocument, segmentId: CaptionSegmentId, text: string): CaptionDocument {
  const index = findSegmentIndex(document, segmentId);
  const segment = document.segments[index];
  if (segment.text === text) return document;

  const segments = [...document.segments];
  segments[index] = { ...segment, text, wordsStale: true };
  return touch(document, segments);
}

/**
 * Updates a segment's start/end time. Rejects (throws) rather than
 * silently clamping or nudging a neighboring segment — Phase 4 brief §9:
 * "prefer predictable edits over surprising automatic changes." Word
 * data is untouched: the words' own timestamps are still exactly as
 * accurate as before, only the segment's outer boundary moved.
 */
export function updateCaptionTiming(
  document: CaptionDocument,
  segmentId: CaptionSegmentId,
  startTime: number,
  endTime: number,
  videoDurationSeconds?: number,
): CaptionDocument {
  const index = findSegmentIndex(document, segmentId);
  const segment = document.segments[index];

  const context: CaptionTimingContext = {
    previousSegmentEndTime: document.segments[index - 1]?.endTime,
    nextSegmentStartTime: document.segments[index + 1]?.startTime,
    videoDurationSeconds,
  };

  const issues = validateCaptionTiming(startTime, endTime, context);
  if (issues.length > 0) {
    throw new InvalidCaptionTimingError(issues.map((issue) => issue.message));
  }

  const segments = [...document.segments];
  segments[index] = { ...segment, startTime, endTime };
  return touch(document, segments);
}

/**
 * Splits a segment before its `splitIndex`-th effective word (real word
 * data if present, else an interpolated stand-in — `getEffectiveWords`,
 * so split works even on a segment with no word-level data at all).
 * `splitIndex` must land strictly between the first and last word so
 * both halves are non-empty.
 */
export function splitCaption(document: CaptionDocument, segmentId: CaptionSegmentId, splitIndex: number): CaptionDocument {
  const index = findSegmentIndex(document, segmentId);
  const segment = document.segments[index];
  const words = getEffectiveWords(segment);

  if (words.length < 2) {
    throw new InvalidCaptionSplitError("This caption has no word boundary to split at.");
  }
  if (!Number.isInteger(splitIndex) || splitIndex <= 0 || splitIndex >= words.length) {
    throw new InvalidCaptionSplitError(`splitIndex must be between 1 and ${words.length - 1}`);
  }

  const firstWords = words.slice(0, splitIndex);
  const secondWords = words.slice(splitIndex);

  const first: CaptionSegment = {
    id: generateId(),
    startTime: segment.startTime,
    endTime: firstWords[firstWords.length - 1].endTime,
    text: joinWordsAsText(firstWords),
    words: firstWords,
    wordsStale: segment.wordsStale,
  };
  const second: CaptionSegment = {
    id: generateId(),
    startTime: secondWords[0].startTime,
    endTime: segment.endTime,
    text: joinWordsAsText(secondWords),
    words: secondWords,
    wordsStale: segment.wordsStale,
  };

  if (first.endTime <= first.startTime || second.endTime <= second.startTime) {
    throw new InvalidCaptionSplitError("Splitting here would produce a caption with zero or negative duration.");
  }

  const segments = [...document.segments.slice(0, index), first, second, ...document.segments.slice(index + 1)];
  return touch(document, segments);
}

/**
 * Merges two adjacent segments into one. Adjacency is required — Phase 4
 * brief §11: "do not merge arbitrary captions scattered throughout the
 * document." If either side's text was manually edited (`wordsStale`),
 * the merged text is built from the raw `text` fields, never
 * reconstructed from the (now unreliable) `words` — merging must never
 * silently discard a user's edit.
 */
export function mergeCaptions(
  document: CaptionDocument,
  firstSegmentId: CaptionSegmentId,
  secondSegmentId: CaptionSegmentId,
): CaptionDocument {
  const firstIndex = findSegmentIndex(document, firstSegmentId);
  const secondIndex = findSegmentIndex(document, secondSegmentId);

  if (secondIndex !== firstIndex + 1) {
    throw new SegmentsNotAdjacentError();
  }

  const first = document.segments[firstIndex];
  const second = document.segments[secondIndex];
  const mergedWordsStale = Boolean(first.wordsStale || second.wordsStale);
  const mergedWords = [...first.words, ...second.words];

  const merged: CaptionSegment = {
    id: generateId(),
    startTime: first.startTime,
    endTime: second.endTime,
    text: mergedWordsStale ? `${first.text.trim()} ${second.text.trim()}`.trim() : joinWordsAsText(mergedWords),
    words: mergedWords,
    wordsStale: mergedWordsStale,
  };

  const segments = [
    ...document.segments.slice(0, firstIndex),
    merged,
    ...document.segments.slice(secondIndex + 1),
  ];
  return touch(document, segments);
}
