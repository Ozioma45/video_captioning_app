/**
 * Domain caption model — provider-independent (see ARCHITECTURE.md §6-7).
 *
 * Word-level timing is preserved end to end: every `CaptionSegment` keeps
 * its `CaptionWord[]` even after the segment's text has been manually
 * edited (CLAUDE.md "Preserve word-level timestamps"). Segmentation is a
 * derived transform (`words + rules -> segments`), not a destructive
 * one-time step — the rules that produced a document are kept alongside it
 * so segmentation can be safely re-run.
 */

export type CaptionWordId = string;
export type CaptionSegmentId = string;
export type CaptionDocumentId = string;

export interface CaptionWord {
  id: CaptionWordId;
  text: string;
  startTime: number;
  endTime: number;
  approximate?: boolean;
}

export interface CaptionSegment {
  id: CaptionSegmentId;
  startTime: number;
  endTime: number;
  /** Current (possibly edited) display text for this segment. */
  text: string;
  words: CaptionWord[];
  /**
   * True once `text` has been manually edited (Phase 4) in a way that may
   * no longer correspond word-for-word to `words`. `words` is never
   * cleared or rewritten when this happens — the last-known timing is
   * still preserved, just flagged as unreliable for word-level sync
   * (karaoke/highlight styles, word-accurate seeking) rather than
   * fabricating new per-word timestamps. See
   * `domain/caption-engine/captionMutations.ts`.
   */
  wordsStale?: boolean;
}

export interface SegmentationRules {
  maxWordsPerSegment: number;
  maxCharsPerLine: number;
  maxLines: number;
  minSegmentDurationSeconds: number;
  maxSegmentDurationSeconds: number;
  breakOnPunctuation: boolean;
  /**
   * A gap between two consecutive words' timestamps larger than this is
   * treated as a natural pause — a preferred segment boundary (Phase 4).
   */
  pauseThresholdSeconds: number;
  /**
   * A caption stays visible up to this long after its last word ends, but
   * never past the next caption's start — so it doesn't vanish the instant
   * the word ends, without bridging real silence.
   */
  maxHoldSeconds: number;
}

export interface CaptionDocument {
  id: CaptionDocumentId;
  videoId: string;
  language: string;
  /**
   * Flat word list as originally normalized from the transcription
   * provider. Never mutated by editing — the source of truth for
   * "reset to original transcript".
   */
  originalWords: CaptionWord[];
  /** Rules used to derive `segments` from the (possibly edited) words. */
  segmentationRules: SegmentationRules;
  /** Current, editable caption segments shown in the editor/preview/export. */
  segments: CaptionSegment[];
  createdAt: string;
  updatedAt: string;
}
