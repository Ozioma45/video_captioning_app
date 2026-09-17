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
