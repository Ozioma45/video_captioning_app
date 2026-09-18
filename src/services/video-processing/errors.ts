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

/**
 * Classifies a raw `execFile` failure from running ffprobe.
 *
 * Node gives a *string* errno code (e.g. `ENOENT`, `EACCES`, `ENOTDIR`)
 * when the OS couldn't even start the process — that's a tooling/
 * environment problem, never a fact about the uploaded file, and must not
 * be reported to the user as "invalid video" (a debugging incident on
 * 2026-09-17 traced a false "invalid video" rejection of a genuinely valid
 * video back to exactly this case: ffprobe couldn't be launched by a stale
 * dev-server process, but every non-ENOENT exec failure was being lumped
 * into `UnreadableVideoError`, and neither path logged anything server-
 * side, making the real cause invisible).
 *
 * A *numeric* exit code means ffprobe actually ran, looked at the file,
 * and rejected it — that's a real, expected `UnreadableVideoError`.
 */
export function classifyFfprobeExecError(error: unknown): FfprobeUnavailableError | UnreadableVideoError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string") {
    return new FfprobeUnavailableError(error);
  }
  return new UnreadableVideoError("ffprobe could not read this file", error);
}
