import { isSpawnFailure } from "@/lib/execErrorClassification";

export class FfprobeUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("ffprobe binary could not be run");
    this.name = "FfprobeUnavailableError";
    this.cause = cause;
  }
}

export class UnreadableVideoError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(reason);
    this.name = "UnreadableVideoError";
    this.cause = cause;
  }
}

/** Real ffmpeg failure while extracting audio from an otherwise-valid video (Phase 3). */
export class AudioExtractionFailedError extends Error {
  constructor(cause?: unknown) {
    super("ffmpeg could not extract audio from this video");
    this.name = "AudioExtractionFailedError";
    this.cause = cause;
  }
}

/** ffmpeg itself couldn't be launched (Phase 3) — a tooling problem, not a fact about the video. */
export class FfmpegUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("ffmpeg binary could not be run");
    this.name = "FfmpegUnavailableError";
    this.cause = cause;
  }
}

/**
 * Classifies a raw `execFile` failure from running ffprobe. See
 * `isSpawnFailure`'s doc comment for why the string/numeric distinction
 * matters — this traces back to a Phase 2 incident (2026-09-17) where a
 * tooling failure was silently misreported as "invalid video."
 */
export function classifyFfprobeExecError(error: unknown): FfprobeUnavailableError | UnreadableVideoError {
  if (isSpawnFailure(error)) {
    return new FfprobeUnavailableError(error);
  }
  return new UnreadableVideoError("ffprobe could not read this file", error);
}

/** Same classification, for ffmpeg's audio-extraction step. */
export function classifyFfmpegExecError(error: unknown): FfmpegUnavailableError | AudioExtractionFailedError {
  if (isSpawnFailure(error)) {
    return new FfmpegUnavailableError(error);
  }
  return new AudioExtractionFailedError(error);
}

/** ffmpeg ran but failed while burning captions in (Phase 7). `stderrTail` is server-side diagnostics only. */
export class RenderFailedError extends Error {
  readonly stderrTail?: string;
  constructor(cause?: unknown, stderrTail?: string) {
    super("ffmpeg could not render the captioned video");
    this.name = "RenderFailedError";
    this.cause = cause;
    this.stderrTail = stderrTail;
  }
}

/** Same classification, for ffmpeg's caption render step. */
export function classifyFfmpegRenderError(error: unknown): FfmpegUnavailableError | RenderFailedError {
  if (isSpawnFailure(error)) return new FfmpegUnavailableError(error);
  return new RenderFailedError(error, (error as { stderr?: string } | undefined)?.stderr);
}
