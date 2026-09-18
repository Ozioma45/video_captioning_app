"use client";

import { useState, type KeyboardEvent } from "react";

import { formatCaptionTime, parseCaptionTime } from "@/domain/caption-engine/captionTimeFormat";
import { validateCaptionTiming, type CaptionTimingContext } from "@/domain/caption-engine/captionTimingValidation";
import { cn } from "@/lib/utils";

interface CaptionTimingProps {
  startTime: number;
  endTime: number;
  context: CaptionTimingContext;
  onCommit: (startTime: number, endTime: number) => void;
}

/**
 * Editable start/end time pair, format `MM:SS.ss` (Phase 4 brief §8).
 * Local text state while editing — parsed/validated on blur or Enter,
 * never per keystroke; Escape reverts to the last committed value. The
 * canonical value stays plain seconds (`onCommit`'s params) — nothing
 * here stores a formatted string as data.
 */
export function CaptionTiming({ startTime, endTime, context, onCommit }: CaptionTimingProps) {
  const [startText, setStartText] = useState(() => formatCaptionTime(startTime));
  const [endText, setEndText] = useState(() => formatCaptionTime(endTime));
  const [error, setError] = useState<string | null>(null);

  // Re-sync local text when the canonical time changes for a reason
  // other than this component's own commit (e.g. a split/merge that
  // altered this same segment's boundary). React's sanctioned "adjust
  // state during render" pattern, not an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [syncedStartTime, setSyncedStartTime] = useState(startTime);
  const [syncedEndTime, setSyncedEndTime] = useState(endTime);
  if (startTime !== syncedStartTime) {
    setSyncedStartTime(startTime);
    setStartText(formatCaptionTime(startTime));
  }
  if (endTime !== syncedEndTime) {
    setSyncedEndTime(endTime);
    setEndText(formatCaptionTime(endTime));
  }

  function revert() {
    setStartText(formatCaptionTime(startTime));
    setEndText(formatCaptionTime(endTime));
    setError(null);
  }

  function commit(nextStartText: string, nextEndText: string) {
    const parsedStart = parseCaptionTime(nextStartText);
    const parsedEnd = parseCaptionTime(nextEndText);

    if (parsedStart === null || parsedEnd === null) {
      setError("Use the format MM:SS.ss, e.g. 00:03.40.");
      return;
    }

    const issues = validateCaptionTiming(parsedStart, parsedEnd, context);
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }

    setError(null);
    onCommit(parsedStart, parsedEnd);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(startText, endText);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      revert();
      event.currentTarget.blur();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <input
          value={startText}
          onChange={(event) => setStartText(event.target.value)}
          onBlur={() => commit(startText, endText)}
          onKeyDown={handleKeyDown}
          aria-label="Caption start time"
          className={cn(
            "w-16 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary focus:outline-none",
            error && "border-destructive text-destructive",
          )}
        />
        <span aria-hidden>→</span>
        <input
          value={endText}
          onChange={(event) => setEndText(event.target.value)}
          onBlur={() => commit(startText, endText)}
          onKeyDown={handleKeyDown}
          aria-label="Caption end time"
          className={cn(
            "w-16 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary focus:outline-none",
            error && "border-destructive text-destructive",
          )}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
