/**
 * Parses ffmpeg's `-progress pipe:1` output into real, honest progress —
 * never a fabricated percentage (PROJECT.md §38).
 *
 * Deliberately parses the human-readable `out_time=HH:MM:SS.ssssss` field,
 * not `out_time_ms`/`out_time_us` — verified directly against the actual
 * ffmpeg build this project uses (`@ffmpeg-installer/ffmpeg`) that
 * `out_time_ms` reports *microseconds*, not milliseconds (a known,
 * long-standing ffmpeg quirk). `out_time=` has no such ambiguity.
 */

const OUT_TIME_PATTERN = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;

/** Returns the latest `out_time` seen in `buffer`, in seconds, or null if none found. */
export function extractLatestOutTimeSeconds(buffer: string): number | null {
  OUT_TIME_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let latest: number | null = null;

  while ((match = OUT_TIME_PATTERN.exec(buffer)) !== null) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
      latest = hours * 3600 + minutes * 60 + seconds;
    }
  }

  return latest;
}

/** Converts an elapsed-output-time into a 0-100 percent against the known total duration. */
export function computeProgressPercent(elapsedSeconds: number, totalDurationSeconds: number): number {
  if (totalDurationSeconds <= 0) return 0;
  const percent = (elapsedSeconds / totalDurationSeconds) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
