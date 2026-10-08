import { isSpawnFailure } from "@/lib/execErrorClassification";

/**
 * Setup/configuration errors — thrown *before* attempting to spawn
 * anything, from a plain file-existence check. These must never be
 * reported to the user the way an "invalid video" is (PROJECT.md/Phase 3
 * brief: "a missing Whisper model must result in a clear setup error, not
 * an invalid video error").
 */
export class WhisperBinaryMissingError extends Error {
  constructor() {
    super("WHISPER_BINARY_PATH is not configured or the file does not exist");
    this.name = "WhisperBinaryMissingError";
  }
}

export class WhisperModelMissingError extends Error {
  constructor() {
    super("WHISPER_MODEL_PATH is not configured or the file does not exist");
    this.name = "WhisperModelMissingError";
  }
}

/** whisper.cpp couldn't be launched at all — a tooling problem, not a fact about the audio. */
export class WhisperUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("whisper.cpp could not be run");
    this.name = "WhisperUnavailableError";
    this.cause = cause;
  }
}

/** whisper.cpp ran and exited non-zero — it looked at the audio and failed on it. */
export class TranscriptionProcessError extends Error {
  constructor(cause?: unknown) {
    super("whisper.cpp exited with an error while transcribing");
    this.name = "TranscriptionProcessError";
    this.cause = cause;
  }
}

/** The provider's raw output doesn't match the shape we know how to read. */
export class MalformedTranscriptionResultError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(reason);
    this.name = "MalformedTranscriptionResultError";
    this.cause = cause;
  }
}

export function classifyWhisperExecError(error: unknown): WhisperUnavailableError | TranscriptionProcessError {
  if (isSpawnFailure(error)) {
    return new WhisperUnavailableError(error);
  }
  return new TranscriptionProcessError(error);
}

/**
 * whisper.cpp was killed because it exceeded its effective timeout — a
 * distinct case from a non-zero exit (`TranscriptionProcessError`) or a
 * failed spawn (`WhisperUnavailableError`). Carries the numbers needed to
 * explain what happened without dumping a stack trace at the user.
 */
export class WhisperTimeoutError extends Error {
  constructor(
    readonly elapsedMs: number,
    readonly timeoutMs: number,
  ) {
    super(`whisper.cpp transcription timed out after ${Math.round(elapsedMs / 1000)}s (limit ${Math.round(timeoutMs / 1000)}s)`);
    this.name = "WhisperTimeoutError";
  }
}

/** The transcription was cancelled (SIGTERM via the process handle) rather than timing out or failing on its own. */
export class WhisperCancelledError extends Error {
  constructor() {
    super("whisper.cpp transcription was cancelled");
    this.name = "WhisperCancelledError";
  }
}
