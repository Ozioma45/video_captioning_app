/**
 * Local whisper.cpp configuration (PROJECT.md §9, ARCHITECTURE.md §6,
 * confirmed Phase 0 decision). Paths come from environment variables —
 * never hard-coded, never an absolute path baked into application code —
 * so setup is reproducible across machines and a missing model/binary
 * fails with a clear configuration error rather than a mysterious one.
 *
 * See .env.example for the variables a developer needs to set locally.
 */

import { cpus } from "node:os";

export const WHISPER_BINARY_PATH = process.env.WHISPER_BINARY_PATH || null;
export const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || null;

/** BCP-47-ish language hint passed to whisper.cpp; "auto" lets it detect. */
export const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || "auto";

/**
 * Threads passed to whisper.cpp's `-t`. whisper.cpp's own default is a
 * fixed 4 regardless of the host. Measured on an 8-logical-core dev
 * machine (tiny.en, a 278s speech sample): `-t 4` (the built-in default)
 * took 49.96s; `-t 8` took 38.84s — 22% faster, identical transcript.
 * This is free parallelism, not an accuracy trade-off, so it's the
 * default: the number of logical CPUs, unless overridden (e.g. to leave
 * headroom on a shared host).
 */
export const WHISPER_THREADS = (() => {
  const raw = Number(process.env.WHISPER_THREADS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return Math.max(1, cpus().length || 1);
})();

/**
 * Beam-search width / best-of candidates for whisper.cpp's `-bs`/`-bo`.
 * Left unset by default, which means whisper.cpp's own defaults (5/5)
 * apply — unlike thread count, this IS a real speed/accuracy trade-off
 * (more candidate decodings explored), so it is never changed silently.
 *
 * Measured on the same 278s sample: `-t 8 -bs 1 -bo 1` (near-greedy) took
 * 27.55s — 1.8x faster than the default 4-thread config, and 1.4x faster
 * than `-t 8` at the default beam width — with a byte-identical
 * transcript on that sample. That sample is clean, unambiguous
 * synthesized speech, though, so it doesn't exercise the case beam
 * search actually helps with (noisy/ambiguous audio); set both env vars
 * to opt in on a deployment where speed matters more than that margin of
 * accuracy, after checking it against real audio.
 */
export const WHISPER_BEAM_SIZE = (() => {
  const raw = Number(process.env.WHISPER_BEAM_SIZE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
})();
export const WHISPER_BEST_OF = (() => {
  const raw = Number(process.env.WHISPER_BEST_OF);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
})();

/**
 * Absolute timeout override, in milliseconds, for one transcription
 * attempt. If set, it wins outright over `computeWhisperTimeoutMs`'s
 * duration-aware calculation below — useful for a fixed, predictable
 * ceiling on a known deployment. Unset by default.
 */
const WHISPER_TIMEOUT_MS_OVERRIDE = (() => {
  const raw = Number(process.env.WHISPER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
})();

/**
 * Fixed cost added to every run regardless of audio length — process
 * spawn, model load, file I/O, JSON write. Model load for tiny.en was
 * measured under 500ms; this leaves generous margin for a larger model
 * or a cold disk cache.
 */
export const WHISPER_TIMEOUT_OVERHEAD_MS = Number(process.env.WHISPER_TIMEOUT_OVERHEAD_MS) || 5 * 60 * 1000;

/**
 * Assumed worst-case processing speed relative to audio duration: the
 * per-second timeout budget is `audioDurationSeconds / WHISPER_MIN_SPEED_FACTOR`.
 * 0.5 means "assume it might take up to 2x the audio's own length."
 * Deliberately pessimistic — measured throughput on this dev machine with
 * tiny.en was 5.6-10x REAL-TIME (whisper finishes well before the audio's
 * own duration), but the timeout must also tolerate a slower host, a
 * larger model, or a loaded machine, none of which were benchmarked here.
 * This is why the timeout is duration-*aware*, not duration-*derived*:
 * it is duration divided by an assumed speed, with its own overhead and
 * clamp, not just a multiple of duration.
 */
export const WHISPER_MIN_SPEED_FACTOR = Number(process.env.WHISPER_MIN_SPEED_FACTOR) || 0.5;

export const WHISPER_TIMEOUT_MIN_MS = Number(process.env.WHISPER_TIMEOUT_MIN_MS) || 5 * 60 * 1000;
export const WHISPER_TIMEOUT_MAX_MS = Number(process.env.WHISPER_TIMEOUT_MAX_MS) || 4 * 60 * 60 * 1000;

/**
 * Long audio is split into independent whisper.cpp invocations of at most
 * this many seconds each (see `planAudioChunks`/the provider's chunking).
 *
 * Root cause (2026-10-04 investigation, real ~56.6-minute video from a
 * failed production job, same hardware): isolated real-audio runs of
 * 3, 5, 20, 40, and the final 16.5 minutes of that exact file *all*
 * transcribed at 4.9-7.7x realtime — no content, thread, or hardware
 * problem. But one single, uninterrupted whisper.cpp invocation covering
 * the full 56.6 minutes never finished inside a 118-minute budget — over
 * 10x worse than any sub-range of the identical audio. The slowdown is
 * specific to a single long-running invocation, not to the audio or the
 * machine; chunking keeps every individual invocation inside the
 * proven-fast, repeatedly-benchmarked range with a wide safety margin
 * (10 min default vs. 40 real minutes benchmarked clean), whatever its
 * exact internal cause. See ARCHITECTURE.md's Whisper reliability notes.
 *
 * Below this duration, a video still runs as a single invocation —
 * unchanged from before this fix, zero behavior change for short/medium
 * videos (everything under ~12.5 minutes with the default below).
 */
export const WHISPER_CHUNK_DURATION_SECONDS = Number(process.env.WHISPER_CHUNK_DURATION_SECONDS) || 10 * 60;

/**
 * The effective timeout for one transcription attempt. `WHISPER_TIMEOUT_MS`,
 * if set, wins outright; otherwise the duration-aware budget above,
 * always clamped to [WHISPER_TIMEOUT_MIN_MS, WHISPER_TIMEOUT_MAX_MS].
 * `audioDurationSeconds` should be the extracted audio's real duration
 * (falls back to a 0-duration — i.e. just the overhead, clamped to the
 * minimum — if unknown, which is honest: an unknown duration must not
 * silently produce an unbounded or zero timeout).
 */
export function computeWhisperTimeoutMs(audioDurationSeconds: number): number {
  if (WHISPER_TIMEOUT_MS_OVERRIDE !== null) return WHISPER_TIMEOUT_MS_OVERRIDE;

  const duration = Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0 ? audioDurationSeconds : 0;
  const speedFactor = WHISPER_MIN_SPEED_FACTOR > 0 ? WHISPER_MIN_SPEED_FACTOR : 0.5;
  const budgetMs = WHISPER_TIMEOUT_OVERHEAD_MS + (duration * 1000) / speedFactor;

  return Math.min(WHISPER_TIMEOUT_MAX_MS, Math.max(WHISPER_TIMEOUT_MIN_MS, Math.round(budgetMs)));
}
