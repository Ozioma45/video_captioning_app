"use client";

import { findActiveSegment, findActiveWord } from "@/domain/caption-engine/captionLookup";
import { formatCaptionTime } from "@/domain/caption-engine/captionTimeFormat";
import { useCaptionStore, usePlaybackStore } from "@/stores";

/**
 * Development-only readout of what the overlay is deriving. Re-renders on
 * every time change, which is why it is never rendered in production
 * (see VideoPlayer) and why the real overlay doesn't do this.
 */
export function CaptionDebugReadout() {
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const segments = useCaptionStore((state) => state.captionDocument?.segments);
  const segment = segments ? findActiveSegment(segments, currentTime) : null;
  const word = segment ? findActiveWord(segment, currentTime) : null;

  return (
    <p data-caption-debug className="font-mono text-xs text-muted-foreground">
      dev · time {formatCaptionTime(currentTime)} · segment {segment?.id ?? "none"} · word {word?.id ?? "none"}
    </p>
  );
}
