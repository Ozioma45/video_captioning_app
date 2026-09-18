import type { SegmentationRules } from "@/types";

/**
 * Descriptive defaults only — no rule-based segmentation algorithm runs
 * against them yet. Phase 3 uses whisper.cpp's own segment boundaries
 * as-is (PROJECT.md §12: "preserve original transcription segments");
 * the configurable re-segmentation engine these rules describe is built
 * in Phase 4.
 */
export const DEFAULT_SEGMENTATION_RULES: SegmentationRules = {
  maxWordsPerSegment: 8,
  maxCharsPerLine: 40,
  maxLines: 2,
  minSegmentDurationSeconds: 0.5,
  maxSegmentDurationSeconds: 6,
  breakOnPunctuation: true,
};
