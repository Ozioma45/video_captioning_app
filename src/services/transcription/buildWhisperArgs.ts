/**
 * Pure whisper.cpp argument-array builder — mirrors
 * `video-processing/buildRenderArgs.ts`'s split of "decide the args" from
 * "run the process," so the argument logic is unit-testable without
 * spawning anything. Every value here is either a fixed flag or a
 * server-controlled path/number; caption text never appears on this
 * command line (CLAUDE.md "never construct unsafe shell commands" — this
 * still returns a plain array for `spawn`/`execFile`, never a string).
 */

export interface BuildWhisperArgsOptions {
  modelPath: string;
  audioFilePath: string;
  language: string;
  outputBasename: string;
  /** `-t`: see config/whisper.ts's WHISPER_THREADS doc for why this isn't whisper.cpp's own default. */
  threads: number;
  /** `-bs`/`-bo`: null means "omit the flag," i.e. defer to whisper.cpp's own default (5/5). */
  beamSize: number | null;
  bestOf: number | null;
  /** `-pp`: emit `whisper_print_progress_callback: progress = NN%` on stderr (see parseWhisperProgress.ts). */
  reportProgress: boolean;
}

export function buildWhisperArgs(options: BuildWhisperArgsOptions): string[] {
  // Do NOT pass `-nt` (--no-timestamps): it disables whisper's timestamp
  // tokens, which collapses the output into one segment per 30 s window
  // and makes word times drift by many seconds (found 2026-09-24 by
  // comparing a real 40 s transcription with and without it). `-ojf`
  // only writes JSON, so nothing needs suppressing.
  const args = [
    "-m",
    options.modelPath,
    "-f",
    options.audioFilePath,
    "-l",
    options.language,
    "-ojf",
    "-of",
    options.outputBasename,
    "-t",
    String(options.threads),
  ];

  if (options.beamSize !== null) args.push("-bs", String(options.beamSize));
  if (options.bestOf !== null) args.push("-bo", String(options.bestOf));
  if (options.reportProgress) args.push("-pp");

  return args;
}
