import type { TranscriptionResult, TranscriptionSegment, TranscriptionWord } from "@/types";

/**
 * Combines one `TranscriptionResult` per audio chunk (see
 * `planAudioChunks`) back into a single result spanning the whole file —
 * pure, so the offset arithmetic is unit-testable without spawning
 * anything. Each chunk's segment/word timestamps are relative to that
 * chunk's own audio; adding the chunk's start offset makes them absolute
 * again, exactly preserving real word-level timing (never re-estimated —
 * CLAUDE.md "preserve word-level timestamps").
 *
 * The only per-chunk boundary cost: a word or sentence that happened to
 * fall exactly on a chunk cut loses a little cross-chunk context (the
 * same trade-off whisper.cpp's own internal 30s windows already make,
 * just at a much coarser, far less frequent grain here).
 */
export function mergeChunkedTranscriptionResults(
  chunks: ReadonlyArray<{ result: TranscriptionResult; offsetSeconds: number }>,
): TranscriptionResult {
  if (chunks.length === 0) return { language: "unknown", segments: [] };
  if (chunks.length === 1 && chunks[0].offsetSeconds === 0) return chunks[0].result;

  const segments: TranscriptionSegment[] = [];
  for (const { result, offsetSeconds } of chunks) {
    for (const segment of result.segments) {
      const words: TranscriptionWord[] = segment.words.map((word) => ({
        ...word,
        start: word.start + offsetSeconds,
        end: word.end + offsetSeconds,
      }));
      segments.push({ ...segment, start: segment.start + offsetSeconds, end: segment.end + offsetSeconds, words });
    }
  }

  return { language: chunks[0].result.language, segments };
}
