import type { SegmentationRules } from "@/types";

/**
 * Defaults for `segmentCaptions` — applied to every fresh transcription
 * (`normalizeTranscription`) and stored on the resulting document.
 *
 * Sized for readable, speech-following captions, not paragraphs: at most
 * ~9 words / 42 characters (one line at a comfortable size) and 4.5 s on
 * screen. Whisper's own segments (often whole sentences or 30 s windows)
 * are deliberately NOT used as display captions.
 */
export const DEFAULT_SEGMENTATION_RULES: SegmentationRules = {
  maxWordsPerSegment: 9,
  maxCharsPerLine: 42,
  maxLines: 1,
  minSegmentDurationSeconds: 0.8,
  maxSegmentDurationSeconds: 4.5,
  breakOnPunctuation: true,
  pauseThresholdSeconds: 0.5,
  maxHoldSeconds: 0.3,
};
