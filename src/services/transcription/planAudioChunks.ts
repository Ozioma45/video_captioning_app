/**
 * Pure planner for splitting a long audio duration into bounded chunks
 * for independent whisper.cpp invocations (see
 * `WhisperCppTranscriptionProvider`'s chunking). Each chunk becomes its
 * own fresh process — proven fast in isolation at every duration actually
 * benchmarked (3–40+ real minutes, 5–7x realtime); a single,
 * uninterrupted whisper.cpp invocation on this project's real ~56-minute
 * benchmark video never finished inside a 118-minute budget. Splitting
 * keeps every individual invocation well inside the proven-fast regime,
 * with a wide safety margin, regardless of the exact internal cause.
 */

export interface AudioChunkPlan {
  index: number;
  startSeconds: number;
  endSeconds: number;
}

/**
 * A trailing remainder shorter than this fraction of `chunkDurationSeconds`
 * is folded into the previous chunk instead of becoming its own
 * (wastefully small) extra invocation.
 */
const MIN_TRAILING_CHUNK_FRACTION = 0.25;

export function planAudioChunks(totalDurationSeconds: number, chunkDurationSeconds: number): AudioChunkPlan[] {
  if (!(totalDurationSeconds > 0)) return [];
  if (!(chunkDurationSeconds > 0)) throw new Error("chunkDurationSeconds must be positive");

  if (totalDurationSeconds <= chunkDurationSeconds) {
    return [{ index: 0, startSeconds: 0, endSeconds: totalDurationSeconds }];
  }

  const chunks: AudioChunkPlan[] = [];
  let start = 0;
  let index = 0;
  while (start < totalDurationSeconds) {
    const remaining = totalDurationSeconds - start;
    const isLast = remaining <= chunkDurationSeconds * (1 + MIN_TRAILING_CHUNK_FRACTION);
    const end = isLast ? totalDurationSeconds : start + chunkDurationSeconds;
    chunks.push({ index, startSeconds: start, endSeconds: end });
    start = end;
    index += 1;
  }
  return chunks;
}
