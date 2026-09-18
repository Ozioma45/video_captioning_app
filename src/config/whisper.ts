/**
 * Local whisper.cpp configuration (PROJECT.md §9, ARCHITECTURE.md §6,
 * confirmed Phase 0 decision). Paths come from environment variables —
 * never hard-coded, never an absolute path baked into application code —
 * so setup is reproducible across machines and a missing model/binary
 * fails with a clear configuration error rather than a mysterious one.
 *
 * See .env.example for the variables a developer needs to set locally.
 */

export const WHISPER_BINARY_PATH = process.env.WHISPER_BINARY_PATH || null;
export const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || null;

/** BCP-47-ish language hint passed to whisper.cpp; "auto" lets it detect. */
export const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || "auto";

/**
 * whisper.cpp transcribes roughly in the same ballpark as real-time on a
 * modern CPU with a small/base model (PROJECT.md explicitly accepts a
 * long-running local transcription process in V1 — ARCHITECTURE.md §16
 * risk register). Default ceiling is generous rather than tight, and is
 * itself configurable since actual throughput depends entirely on the
 * developer's hardware and chosen model size.
 */
export const WHISPER_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS) || 4 * 60 * 60 * 1000;
