export type CaptionTimingIssueCode =
  | "not_finite"
  | "negative_start"
  | "invalid_range"
  | "overlaps_previous"
  | "overlaps_next"
  | "exceeds_video_duration";

export interface CaptionTimingIssue {
  code: CaptionTimingIssueCode;
  message: string;
}

export interface CaptionTimingContext {
  /** The immediately preceding segment's end time, if any — for overlap detection. */
  previousSegmentEndTime?: number;
  /** The immediately following segment's start time, if any — for overlap detection. */
  nextSegmentStartTime?: number;
  /** The source video's known duration — omit to skip that check (e.g. metadata not loaded yet). */
  videoDurationSeconds?: number;
}

/**
 * Reusable caption timing validator (Phase 4 brief §9). Returns every
 * issue found, not just the first, so the UI can show a complete,
 * specific reason rather than a generic "invalid" — never automatically
 * adjusts a neighbor to make an edit fit; that's the caller's decision to
 * reject.
 */
export function validateCaptionTiming(
  startTime: number,
  endTime: number,
  context: CaptionTimingContext = {},
): CaptionTimingIssue[] {
  const issues: CaptionTimingIssue[] = [];

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    issues.push({ code: "not_finite", message: "Start and end times must be valid numbers." });
    return issues; // no other check is meaningful against NaN/Infinity
  }

  if (startTime < 0) {
    issues.push({ code: "negative_start", message: "Start time can't be negative." });
  }

  if (endTime <= startTime) {
    issues.push({ code: "invalid_range", message: "End time must be after the start time." });
  }

  if (context.previousSegmentEndTime !== undefined && startTime < context.previousSegmentEndTime) {
    issues.push({ code: "overlaps_previous", message: "This overlaps the previous caption." });
  }

  if (context.nextSegmentStartTime !== undefined && endTime > context.nextSegmentStartTime) {
    issues.push({ code: "overlaps_next", message: "This overlaps the next caption." });
  }

  if (context.videoDurationSeconds !== undefined && endTime > context.videoDurationSeconds) {
    issues.push({ code: "exceeds_video_duration", message: "This extends past the end of the video." });
  }

  return issues;
}
