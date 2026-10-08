/**
 * Parses whisper.cpp's `--print-progress` (`-pp`) output into real,
 * honest progress — never a fabricated percentage (PROJECT.md §38).
 * Verified directly against the whisper.cpp build this project uses:
 * `-pp` writes lines like `whisper_print_progress_callback: progress =  64%`
 * to stderr, interleaved with nothing else on that stream (transcript
 * text goes to stdout). Progress can be reported past 100% right before
 * the process exits (observed: 107%) — callers must clamp.
 */

const PROGRESS_PATTERN = /whisper_print_progress_callback: progress\s*=\s*(\d+)%/g;

/** Returns the latest progress percentage (0-100, clamped) seen in `buffer`, or null if none found. */
export function extractLatestWhisperProgressPercent(buffer: string): number | null {
  PROGRESS_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let latest: number | null = null;

  while ((match = PROGRESS_PATTERN.exec(buffer)) !== null) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) latest = Math.max(0, Math.min(100, value));
  }

  return latest;
}

/**
 * Strips progress-callback lines out of a stderr chunk, so the tail kept
 * for failure diagnostics isn't crowded out by dozens of routine progress
 * lines on a long transcription — the actual error (if any) stays visible
 * in the kept tail instead of scrolling out.
 */
export function stripWhisperProgressLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/whisper_print_progress_callback:/.test(line))
    .join("\n");
}
