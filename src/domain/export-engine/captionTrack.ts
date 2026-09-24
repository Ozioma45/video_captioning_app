import { hasUsableWordTiming } from "@/domain/caption-engine/captionLookup";
import { resolveCaptionDisplay } from "@/domain/style-engine/captionDisplay";
import type { CaptionSegment, CaptionStyle, TextTransform } from "@/types";

/**
 * The renderer-independent description of what is on screen when — the
 * export counterpart of what `CaptionOverlay` derives per frame. It is
 * built from the SAME domain decisions the preview uses:
 *
 * - which segment is visible: `[startTime, endTime)`, with a segment cut
 *   short by the next one's start (the overlay's `findActiveSegment`
 *   picks the latest-starting active segment);
 * - plain text vs. individually highlighted words: `resolveCaptionDisplay`
 *   (so stale / missing / malformed word timing falls back to plain text
 *   exactly as in the preview);
 * - which word is highlighted when: the real word timestamps, with
 *   `findActiveWord`'s semantics — start-inclusive, end-exclusive, and no
 *   highlight between words.
 *
 * Nothing here estimates timing; nothing mutates the input.
 */

export interface CaptionRun {
  text: string;
  highlighted: boolean;
}

export interface CaptionTrackEvent {
  segmentId: string;
  startTime: number;
  endTime: number;
  /** True for the first event of a segment — the one that plays the entrance animation. */
  entrance: boolean;
  runs: CaptionRun[];
}

export function applyTextTransform(text: string, transform: TextTransform): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|\s)(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
    default:
      return text;
  }
}

/** Collapses whitespace the way HTML layout does in the preview. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildCaptionTrack(segments: readonly CaptionSegment[], style: CaptionStyle): CaptionTrackEvent[] {
  const events: CaptionTrackEvent[] = [];
  const transform = style.typography.textTransform;

  segments.forEach((segment, index) => {
    const start = segment.startTime;
    let end = segment.endTime;
    const next = segments[index + 1];
    if (next && next.startTime < end) end = Math.max(start, next.startTime);
    if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) return;

    const display = resolveCaptionDisplay(segment, style);

    if (display.kind === "plain") {
      events.push({
        segmentId: segment.id,
        startTime: start,
        endTime: end,
        entrance: true,
        runs: [{ text: applyTextTransform(normalizeWhitespace(display.text), transform), highlighted: false }],
      });
      return;
    }

    const wordRuns = (highlightedId: string | null): CaptionRun[] =>
      display.words.map((word, wordIndex) => ({
        text: applyTextTransform((wordIndex > 0 && word.spaceBefore ? " " : "") + word.text, transform),
        highlighted: word.id === highlightedId,
      }));

    if (!display.trackActiveWord) {
      // Static emphasis: one event for the whole segment.
      events.push({
        segmentId: segment.id,
        startTime: start,
        endTime: end,
        entrance: true,
        runs: wordRuns(display.emphasisWordId),
      });
      return;
    }

    // Active-word tracking: one event per state — "word i highlighted" for
    // the word's own interval, "nothing highlighted" for the gaps — so the
    // highlight is on exactly while the word's real timestamps say it is.
    if (!hasUsableWordTiming(segment)) return; // unreachable: display.kind === "words" implies usable timing
    let cursor = start;
    let first = true;
    const push = (from: number, to: number, highlightedId: string | null) => {
      if (to <= from) return;
      events.push({ segmentId: segment.id, startTime: from, endTime: to, entrance: first, runs: wordRuns(highlightedId) });
      first = false;
    };

    segment.words.forEach((word) => {
      const wordStart = Math.max(word.startTime, cursor);
      const wordEnd = Math.min(word.endTime, end);
      if (wordEnd <= wordStart) return; // zero-length / already-passed / outside the segment: never highlighted
      push(cursor, wordStart, null);
      push(wordStart, wordEnd, word.id);
      cursor = wordEnd;
    });
    push(cursor, end, null);
  });

  return events;
}
