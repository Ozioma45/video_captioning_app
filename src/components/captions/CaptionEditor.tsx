"use client";

import { useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { useCaptionStore, usePlaybackStore } from "@/stores";
import { CaptionList } from "./CaptionList";
import { CaptionToolbar } from "./CaptionToolbar";

/**
 * Top-level caption editor — now rendered as a full-width bottom
 * workspace (UI revision) rather than a narrow sidebar card, giving
 * captions room to be read and edited comfortably. Composition root for
 * keyboard navigation and the one place selection is turned into a video
 * seek — centralizing it here (rather than in each `CaptionItem`) means
 * editing a caption's text never re-triggers a seek; only an actual
 * *selection* change does (see the effect below, which depends only on
 * `selectedSegmentId`, never on the document's content).
 *
 * `CaptionEditor → CaptionToolbar`/`CaptionList → CaptionItem` all read
 * from `useCaptionStore`, which itself only wraps the pure functions in
 * `domain/caption-engine/captionMutations.ts` — this component tree
 * never invents its own caption state (Phase 4 brief §3).
 */
export function CaptionEditor() {
  const segmentCount = useCaptionStore((state) => state.captionDocument?.segments.length ?? 0);
  const selectedSegmentId = useCaptionStore((state) => state.selectedSegmentId);
  const selectNextCaption = useCaptionStore((state) => state.selectNextCaption);
  const selectPreviousCaption = useCaptionStore((state) => state.selectPreviousCaption);
  const lastError = useCaptionStore((state) => state.lastError);
  const requestSeek = usePlaybackStore((state) => state.requestSeek);

  useEffect(() => {
    if (!selectedSegmentId) return;
    const segment = useCaptionStore.getState().captionDocument?.segments.find((s) => s.id === selectedSegmentId);
    if (segment) requestSeek(segment.startTime);
  }, [selectedSegmentId, requestSeek]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      // Never hijack normal typing — only act when focus isn't in a
      // text field (Phase 4 brief §13).
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectNextCaption();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        selectPreviousCaption();
      }
    },
    [selectNextCaption, selectPreviousCaption],
  );

  if (segmentCount === 0) {
    return <p className="text-sm text-muted-foreground">No captions yet.</p>;
  }

  return (
    <div onKeyDown={handleKeyDown} tabIndex={-1} className="flex flex-col gap-3">
      <CaptionToolbar />
      {lastError && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{lastError}</span>
        </div>
      )}
      {/* Controlled height with its own scroll (UI revision §7) — a
          long-form video's caption list never expands the page
          indefinitely; the video above stays in view while scrolling. */}
      <div className="max-h-[26rem] overflow-y-auto pr-1">
        <CaptionList />
      </div>
    </div>
  );
}
