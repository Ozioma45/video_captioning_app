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
