import type { CaptionSegment, CaptionWord } from "@/types";

/**
 * Playback-time lookups for the Phase 6 preview. Pure, derived from
 * `(segments, time)` only — nothing here is stored, so seeking can never
 * leave stale "active" state behind. All times are **seconds**, the
 * unit `CaptionSegment`/`CaptionWord` and `HTMLVideoElement.currentTime`
 * already share, so no unit conversion exists anywhere in the pipeline.
 *
 * Boundary convention everywhere: start-inclusive, end-exclusive —
 * `start <= t < end`.
 */

/** How far back to look for a still-active segment when data is malformed (overlapping). */
const OVERLAP_LOOKBACK = 4;

/**
 * The segment visible at `timeSeconds`, or null. `segments` must be sorted
 * by `startTime` (the caption mutations keep it so): a binary search finds
 * the last segment that has started, O(log n) for documents with
 * thousands of segments. If segments overlap (malformed data) the
 * latest-starting active one wins, found by a short bounded look-back.
 */
export function findActiveSegment(
  segments: readonly CaptionSegment[],
  timeSeconds: number,
): CaptionSegment | null {
  if (!Number.isFinite(timeSeconds) || segments.length === 0) return null;

  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startTime <= timeSeconds) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const stop = Math.max(0, candidate - OVERLAP_LOOKBACK);
  for (let index = candidate; index >= stop; index -= 1) {
    if (timeSeconds < segments[index].endTime) return segments[index];
  }
  return null;
}

/**
 * True when the segment's `words` can drive word-level rendering: present,
 * not flagged stale by a text edit, and with sane, ordered timing. When
 * false, callers render the plain segment text and never invent timing.
 */
export function hasUsableWordTiming(segment: CaptionSegment): boolean {
  const words = segment.words;
  if (segment.wordsStale || !Array.isArray(words) || words.length === 0) return false;

  let previousStart = -Infinity;
  for (const word of words) {
    if (!Number.isFinite(word.startTime) || !Number.isFinite(word.endTime)) return false;
    if (word.endTime < word.startTime || word.startTime < previousStart) return false;
    previousStart = word.startTime;
  }
  return true;
}

/**
 * The word being spoken at `timeSeconds` using the real per-word
 * timestamps, or null (between words, outside the segment, or when the
 * segment has no usable word timing). Never estimates from character
 * counts or splits the duration evenly.
 */
export function findActiveWord(segment: CaptionSegment, timeSeconds: number): CaptionWord | null {
  if (!Number.isFinite(timeSeconds) || !hasUsableWordTiming(segment)) return null;
  for (const word of segment.words) {
    if (timeSeconds < word.startTime) return null;
    if (timeSeconds < word.endTime) return word;
  }
  return null;
}
