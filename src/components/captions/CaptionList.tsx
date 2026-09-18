"use client";

import { useShallow } from "zustand/react/shallow";

import { useCaptionStore } from "@/stores";
import { CaptionItem } from "./CaptionItem";

/**
 * Renders one `CaptionItem` per segment, keyed by stable id (never array
 * index — Phase 4 brief §7). Selects only the array of ids with a
 * shallow comparator, so this list re-renders on add/remove/reorder
 * (split, merge) but not on every text/timing edit to a single caption —
 * that's each `CaptionItem`'s own, narrower subscription (Phase 4 brief
 * §15, structured so a future virtualized list could replace this
 * `<ul>` without touching `CaptionItem` at all).
 */
export function CaptionList() {
  const segmentIds = useCaptionStore(useShallow((state) => state.captionDocument?.segments.map((s) => s.id) ?? []));

  if (segmentIds.length === 0) {
    return <p className="text-sm text-muted-foreground">No captions yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {segmentIds.map((id, index) => (
        <CaptionItem
          key={id}
          segmentId={id}
          index={index}
          nextSegmentId={segmentIds[index + 1]}
          isLast={index === segmentIds.length - 1}
        />
      ))}
    </ul>
  );
}
