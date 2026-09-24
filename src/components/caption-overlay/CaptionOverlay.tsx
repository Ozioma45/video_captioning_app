"use client";

import type { CSSProperties } from "react";

import { findActiveSegment, findActiveWord } from "@/domain/caption-engine/captionLookup";
import { resolveCaptionDisplay } from "@/domain/style-engine/captionDisplay";
import { useCaptionStore, usePlaybackStore, useStyleStore } from "@/stores";
import type { AnimationKind, CaptionSegment, CaptionStyle } from "@/types";
import { styleToCss } from "@/components/style/previewCss";

/** One reference pixel (1080-line frame) as a fraction of the overlay's own height. */
const REFERENCE_FRAME_HEIGHT = 1080;
const cqh = (referencePx: number) => `${(referencePx / REFERENCE_FRAME_HEIGHT) * 100}cqh`;

// Closed map from the style model's AnimationKind to the keyframes in
// globals.css — style data never becomes a CSS string directly.
const ENTRANCE_KEYFRAMES: Partial<Record<AnimationKind, string>> = {
  fade: "caption-fade",
  pop: "caption-pop",
  slide: "caption-slide",
};

/**
 * Phase 6 preview: draws the active caption over the video. Everything it
 * shows is derived per render from `(playback time, caption segments,
 * style)`; it stores nothing. Sized in `cqh` units against its own box
 * (which is pinned to the video's box), so it stays aligned through window
 * resize, layout changes and fullscreen without measuring anything in JS.
 *
 * Subscription granularity: the store selectors below return the active
 * segment / active word *objects*, so a playback tick re-renders this
 * component only when the caption or word actually changes — not per frame.
 */
export function CaptionOverlay() {
  const segments = useCaptionStore((state) => state.captionDocument?.segments);
  const style = useStyleStore((state) => state.styleConfig.style);
  const segment = usePlaybackStore((state) => (segments ? findActiveSegment(segments, state.currentTime) : null));

  return (
    <div
      aria-hidden
      data-caption-overlay
      data-segment-id={segment?.id ?? ""}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ containerType: "size" }}
    >
      {segment && <ActiveCaption key={segment.id} segment={segment} style={style} />}
    </div>
  );
}

function ActiveCaption({ segment, style }: { segment: CaptionSegment; style: CaptionStyle }) {
  const display = resolveCaptionDisplay(segment, style);
  const activeWordId = usePlaybackStore((state) =>
    display.kind === "words" && display.trackActiveWord ? (findActiveWord(segment, state.currentTime)?.id ?? null) : null,
  );

  const { frame, block } = styleToCss(style, { length: cqh, edgeOffset: (percent) => `${percent}cqh` });
  const keyframes = ENTRANCE_KEYFRAMES[style.animation.kind];
  const blockStyle: CSSProperties = {
    ...block,
    animation: keyframes ? `${keyframes} ${style.animation.durationMs}ms ease-out both` : undefined,
    // Words wrap between spans, never inside them.
    overflowWrap: "break-word",
  };

  const wordTransition =
    style.animation.kind === "wordHighlight" || style.animation.kind === "pop"
      ? `color ${style.animation.durationMs}ms ease-out, transform ${style.animation.durationMs}ms ease-out`
      : undefined;

  return (
    <div style={{ ...frame, position: "absolute", inset: 0, boxSizing: "border-box" }}>
      <div data-caption-block data-caption-text={segment.text} style={blockStyle}>
        {display.kind === "plain" ? (
          display.text
        ) : (
          display.words.map((word) => {
            const highlighted = word.id === activeWordId || word.id === display.emphasisWordId;
            const wordStyle: CSSProperties = {
              display: "inline-block",
              color: highlighted ? style.colors.highlight : undefined,
              transform: highlighted && style.animation.kind === "pop" ? "scale(1.12)" : undefined,
              transition: wordTransition,
            };
            return (
              <span key={word.id}>
                {word.spaceBefore ? " " : ""}
                <span data-caption-word data-active={highlighted || undefined} style={wordStyle}>
                  {word.text}
                </span>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
