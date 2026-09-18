/**
 * Shared classification for a failed `execFile` call against an external
 * binary (ffprobe, ffmpeg, whisper.cpp, ...).
 *
 * Node gives a *string* errno code (`ENOENT`, `EACCES`, `ENOTDIR`, ...)
 * when the OS couldn't even start the process — a tooling/environment
 * problem. A *numeric* code means the process launched and exited
 * non-zero — the tool ran and rejected its input. Conflating these is
 * what let a tooling failure masquerade as "invalid video" in a Phase 2
 * incident (see `classifyFfprobeExecError` in
 * services/video-processing/errors.ts) — this helper exists so every
 * exec-backed service classifies failures the same, correct way.
 */
export function isSpawnFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string";
}
