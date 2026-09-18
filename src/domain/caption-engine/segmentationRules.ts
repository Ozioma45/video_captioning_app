import type { SegmentationRules } from "@/types";

/**
 * Defaults for the Phase 4 segmentation engine (`segmentCaptions.ts`).
 * Phase 3 still uses whisper.cpp's own segment boundaries as-is for the
 * *initial* transcription (PROJECT.md §12: "preserve original
 * transcription segments") — these rules are carried on every
 * `CaptionDocument` as descriptive metadata regardless, and are what
 * `segmentCaptions` consumes if/when a document is re-segmented.
 */
export const DEFAULT_SEGMENTATION_RULES: SegmentationRules = {
  maxWordsPerSegment: 8,
  maxCharsPerLine: 40,
  maxLines: 2,
  minSegmentDurationSeconds: 0.5,
  maxSegmentDurationSeconds: 6,
  breakOnPunctuation: true,
  pauseThresholdSeconds: 0.5,
};
