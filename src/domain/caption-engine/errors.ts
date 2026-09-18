/**
 * Thrown when a transcription result is structurally valid but has no
 * usable timing information at all (e.g. every segment has text but zero
 * words and zero interpolation was possible) — distinct from a provider
 * returning malformed data (`MalformedTranscriptionResultError`, which
 * lives in services/transcription/ since it's about the provider's raw
 * shape, not the domain-level data quality).
 */
export class InsufficientTimestampDataError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InsufficientTimestampDataError";
  }
}

/** Phase 4 editing errors — thrown by domain/caption-engine/captionMutations.ts. */

export class CaptionSegmentNotFoundError extends Error {
  constructor(segmentId: string) {
    super(`No caption segment with id ${segmentId}`);
    this.name = "CaptionSegmentNotFoundError";
  }
}

export class InvalidCaptionTimingError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid caption timing: ${issues.join("; ")}`);
    this.name = "InvalidCaptionTimingError";
  }
}

export class InvalidCaptionSplitError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidCaptionSplitError";
  }
}

export class SegmentsNotAdjacentError extends Error {
  constructor() {
    super("Only adjacent caption segments can be merged");
    this.name = "SegmentsNotAdjacentError";
  }
}
