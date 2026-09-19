"use client";

import { useState, type KeyboardEvent } from "react";

import { getEffectiveWords } from "@/domain/caption-engine/wordsText";
import { cn } from "@/lib/utils";
import { useCaptionStore, useProjectStore } from "@/stores";
import type { CaptionSegmentId } from "@/types";
import { CaptionTiming } from "./CaptionTiming";

interface CaptionItemProps {
  segmentId: CaptionSegmentId;
  index: number;
}

/**
 * One caption's editing surface: timing, editable text, select-on-focus,
 * and (only while selected, to keep non-active items cheap — Phase 4
 * brief §15) the word-boundary split picker. Merge, and quick navigation,
 * live one level up in `CaptionToolbar` (UI revision) — surfacing them
 * per-item as well would duplicate the same action in two places for no
 * benefit, and the toolbar already makes unambiguous which caption is
 * selected (its time range is shown right next to those buttons).
 *
 * Subscribes to its *own* segment by id, not the whole document — the
 * mutation functions in `captionMutations.ts` keep unrelated segments'
 * object identity stable across an edit, so editing one caption does not
 * re-render every other `CaptionItem` (Phase 4 brief §6, §15).
 */
export function CaptionItem({ segmentId, index }: CaptionItemProps) {
  const segment = useCaptionStore((state) => state.captionDocument?.segments.find((s) => s.id === segmentId));
  const isSelected = useCaptionStore((state) => state.selectedSegmentId === segmentId);
  const previousSegmentEndTime = useCaptionStore((state) => state.captionDocument?.segments[index - 1]?.endTime);
  const nextSegmentStartTime = useCaptionStore((state) => state.captionDocument?.segments[index + 1]?.startTime);
  const videoDurationSeconds = useProjectStore((state) => state.video?.metadata?.durationSeconds);

  const selectSegment = useCaptionStore((state) => state.selectSegment);
  const updateText = useCaptionStore((state) => state.updateText);
  const updateTiming = useCaptionStore((state) => state.updateTiming);
  const split = useCaptionStore((state) => state.split);

  const [localText, setLocalText] = useState(segment?.text ?? "");
  // Re-sync local editing text when the canonical text changes for a
  // reason other than this component's own commit (e.g. a future
  // undo/reset). React's sanctioned "adjust state during render" pattern
  // for this, not an effect — see https://react.dev/learn/you-might-not-need-an-effect.
  const [syncedText, setSyncedText] = useState(segment?.text ?? "");
  if (segment && segment.text !== syncedText) {
    setSyncedText(segment.text);
    setLocalText(segment.text);
  }

  if (!segment) return null;
  const currentSegment = segment;

  function selectThis() {
    selectSegment(segmentId);
  }

  function commitText() {
    if (localText !== currentSegment.text) updateText(segmentId, localText);
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitText();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setLocalText(currentSegment.text);
      event.currentTarget.blur();
    }
  }

  const effectiveWords = isSelected ? getEffectiveWords(currentSegment) : [];

  return (
    <li
      onMouseDown={selectThis}
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border p-4 transition-colors",
        isSelected ? "border-primary bg-secondary" : "border-border bg-card hover:border-muted-foreground/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <CaptionTiming
          startTime={segment.startTime}
          endTime={segment.endTime}
          context={{ previousSegmentEndTime, nextSegmentStartTime, videoDurationSeconds }}
          onCommit={(startTime, endTime) => updateTiming(segmentId, startTime, endTime)}
        />
        {segment.wordsStale && (
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title="Text was edited; word-level timing may no longer match."
          >
            word timing stale
          </span>
        )}
      </div>

      <textarea
        value={localText}
        onChange={(event) => setLocalText(event.target.value)}
        onFocus={selectThis}
        onBlur={commitText}
        onKeyDown={handleTextKeyDown}
        rows={3}
        className="w-full resize-none rounded-md bg-transparent text-base leading-relaxed focus:outline-none"
        aria-label="Caption text"
      />

      {isSelected && effectiveWords.length >= 2 && (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="mr-1">Split before:</span>
          {effectiveWords.map((word, wordIndex) =>
            wordIndex === 0 ? (
              <span key={word.id} className="px-0.5">
                {word.text}
              </span>
            ) : (
              <button
                key={word.id}
                type="button"
                onClick={() => split(segmentId, wordIndex)}
                className="rounded px-0.5 underline decoration-dotted hover:bg-accent hover:text-foreground"
                title={`Split before "${word.text}"`}
              >
                {word.text}
              </button>
            ),
          )}
        </div>
      )}
    </li>
  );
}
