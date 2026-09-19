"use client";

import { Button } from "@/components/ui/button";
import { formatCaptionTime } from "@/domain/caption-engine/captionTimeFormat";
import { getEffectiveWords } from "@/domain/caption-engine/wordsText";
import { useCaptionStore } from "@/stores";

/**
 * Compact header for the caption workspace: counts, plus — only when a
 * caption is actually selected — which one (its time range, so there's
 * never ambiguity about what Previous/Next/Split/Merge would affect,
 * per the UI revision brief §10) and the corresponding actions.
 *
 * "Split" here defaults to the midpoint word — a quick shortcut; the
 * precise word-boundary picker inside the selected `CaptionItem` is
 * still there for exact control. Both call the same `split` domain
 * action, so there's exactly one source of truth for what a split does.
 */
export function CaptionToolbar() {
  const segmentCount = useCaptionStore((state) => state.captionDocument?.segments.length ?? 0);
  const wordCount = useCaptionStore((state) => state.captionDocument?.originalWords.length ?? 0);
  const language = useCaptionStore((state) => state.captionDocument?.language);
  const selected = useCaptionStore((state) =>
    state.captionDocument?.segments.find((segment) => segment.id === state.selectedSegmentId),
  );
  const nextSegmentId = useCaptionStore((state) => {
    const segments = state.captionDocument?.segments;
    if (!segments || !state.selectedSegmentId) return undefined;
    const index = segments.findIndex((segment) => segment.id === state.selectedSegmentId);
    return index === -1 ? undefined : segments[index + 1]?.id;
  });

  const selectPreviousCaption = useCaptionStore((state) => state.selectPreviousCaption);
  const selectNextCaption = useCaptionStore((state) => state.selectNextCaption);
  const split = useCaptionStore((state) => state.split);
  const merge = useCaptionStore((state) => state.merge);

  const canSplit = selected !== undefined && getEffectiveWords(selected).length >= 2;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <p className="text-xs text-muted-foreground">
        {segmentCount} {segmentCount === 1 ? "segment" : "segments"} · {wordCount} words
        {language ? ` · ${language}` : ""}
      </p>

      <div className="flex items-center gap-1">
        {selected && (
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            {formatCaptionTime(selected.startTime)} → {formatCaptionTime(selected.endTime)}
          </span>
        )}
        <Button variant="ghost" size="sm" disabled={segmentCount === 0} onClick={() => selectPreviousCaption()}>
          Previous
        </Button>
        <Button variant="ghost" size="sm" disabled={segmentCount === 0} onClick={() => selectNextCaption()}>
          Next
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canSplit}
          onClick={() => {
            if (!selected) return;
            const words = getEffectiveWords(selected);
            split(selected.id, Math.floor(words.length / 2));
          }}
        >
          Split
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!selected || !nextSegmentId}
          onClick={() => {
            if (!selected || !nextSegmentId) return;
            merge(selected.id, nextSegmentId);
          }}
        >
          Merge
        </Button>
      </div>
    </div>
  );
}
