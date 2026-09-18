/**
 * Caption-editor time format: `MM:SS.ss` (minutes unbounded, not capped
 * at 59 — "12:03.20" reads as 12 minutes, not 12 hours). Distinct from
 * `lib/format.ts`'s `formatTimecode`, which is whole-seconds player/UI
 * display (H:MM:SS) — editing timing needs centisecond precision, the
 * player display doesn't.
 *
 * The canonical value is always a plain number of seconds
 * (`CaptionWord`/`CaptionSegment` already store seconds) — this module
 * only formats/parses the human-facing string; nothing stores the
 * formatted string as data.
 */

const TIME_INPUT_PATTERN = /^(\d+):([0-5]?\d)(?:\.(\d{1,2}))?$/;

export function formatCaptionTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds - minutes * 60;
  const wholeSeconds = Math.floor(seconds);
  const centiseconds = Math.round((seconds - wholeSeconds) * 100);

  return `${minutes.toString().padStart(2, "0")}:${wholeSeconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}`;
}

/** Parses "MM:SS.ss" (or "MM:SS") back to seconds. Returns null for anything that isn't a clean, valid time. */
export function parseCaptionTime(text: string): number | null {
  const match = TIME_INPUT_PATTERN.exec(text.trim());
  if (!match) return null;

  const [, minutesText, secondsText, centisecondsText] = match;
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const centiseconds = centisecondsText ? Number(centisecondsText.padEnd(2, "0")) : 0;

  const total = minutes * 60 + seconds + centiseconds / 100;
  return Number.isFinite(total) ? total : null;
}
