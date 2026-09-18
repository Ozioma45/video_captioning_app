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
