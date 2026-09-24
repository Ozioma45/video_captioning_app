import { generateId } from "@/lib/id";
import type { CaptionDocument, CaptionWord, TranscriptionResult, TranscriptionSegment } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "./segmentationRules";
import { segmentCaptions } from "./segmentCaptions";
import { InsufficientTimestampDataError } from "./errors";
import { interpolateWordsFromText } from "./interpolateWords";

/**
 * Provider-agnostic normalization: `TranscriptionResult` (any provider) →
 * `CaptionDocument` (the domain model). This is the boundary
 * ARCHITECTURE.md §6-7 describes — nothing whisper.cpp-specific reaches
 * this function; it only knows the already-normalized provider shape.
 *
 * Falls back to evenly-interpolated, explicitly `approximate: true` word
 * timing when a segment has text but no word-level breakdown at all
 * (CLAUDE.md "if a transformation can't preserve exact word timing, it
 * must mark the result as approximate rather than silently dropping it")
 * — this makes the normalizer usable by a future provider that only
 * returns segment-level timing, without ever *pretending* that timing is
 * word-accurate.
 */
export function normalizeTranscription(videoId: string, result: TranscriptionResult): CaptionDocument {
  if (result.segments.length === 0) {
    throw new InsufficientTimestampDataError("Transcription result contains no segments");
  }

  // The provider's segments are transcription structure (whisper.cpp emits
  // whole sentences, or 30 s windows), not display captions. Flatten to the
  // provider's words and let the segmentation engine build the captions;
  // each caption's timing then comes from its own words.
  const originalWords: CaptionWord[] = result.segments.flatMap((segment) =>
    segment.words.length > 0 ? mapProviderWords(segment.words) : interpolateApproximateWords(segment),
  );

  if (originalWords.length === 0) {
    throw new InsufficientTimestampDataError(
      "Transcription produced segments but no usable word-level timing could be derived",
    );
  }

  const now = new Date().toISOString();
  return {
    id: generateId(),
    videoId,
    language: result.language,
    originalWords,
    segmentationRules: DEFAULT_SEGMENTATION_RULES,
    segments: segmentCaptions(originalWords, DEFAULT_SEGMENTATION_RULES),
    createdAt: now,
    updatedAt: now,
  };
}

function mapProviderWords(words: TranscriptionSegment["words"]): CaptionWord[] {
  return words.map((word) => ({
    id: generateId(),
    text: word.text,
    startTime: word.start,
    endTime: word.end,
    approximate: word.approximate,
  }));
}

function interpolateApproximateWords(segment: TranscriptionSegment): CaptionWord[] {
  return interpolateWordsFromText(segment.text, segment.start, segment.end);
}
