import type { CSSProperties } from "react";

import { getCaptionFont } from "@/domain/style-engine/fonts";
import type { CaptionStyle, HexColor } from "@/types";

export function hexToRgba(hex: HexColor, alpha: number): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "000000";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const JUSTIFY = { top: "flex-start", center: "center", bottom: "flex-end" } as const;
const ALIGN = { left: "flex-start", center: "center", right: "flex-end" } as const;

/** How reference-frame pixels and the edge offset become CSS lengths. */
export interface StyleCssUnits {
  /** 1080-line reference pixels → a CSS length. */
  length: (referencePx: number) => string;
  /** Distance-from-edge (percent of frame height) → a CSS length. */
  edgeOffset: (percent: number) => string;
}

/**
 * The single place structured `CaptionStyle` data becomes CSS — shared by
 * the style-picker preview (fixed px scale) and the Phase 6 video overlay
 * (container-relative `cqh` units), so the two can't diverge. No CSS ever
 * flows back into the style model.
 */
export function styleToCss(
  style: CaptionStyle,
  units: StyleCssUnits,
): { frame: CSSProperties; block: CSSProperties } {
  const { typography, colors, background, outline, shadow, position } = style;
  const px = units.length;

  const frame: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    justifyContent: JUSTIFY[position.vertical],
    alignItems: ALIGN[position.horizontal],
    padding: position.vertical === "center" ? 0 : `${units.edgeOffset(position.offsetPercent)} 6%`,
  };

  const hasShadow = shadow.blurPx > 0 || shadow.distancePx > 0;

  const block: CSSProperties = {
    maxWidth: `${position.maxWidthPercent}%`,
    textAlign: position.horizontal,
    fontFamily: getCaptionFont(typography.fontFamily).cssStack,
    fontSize: px(typography.fontSize),
    fontWeight: typography.fontWeight,
    letterSpacing: px(typography.letterSpacing),
    lineHeight: typography.lineHeight,
    textTransform: typography.textTransform,
    color: colors.text,
    background: background.opacity > 0 ? hexToRgba(colors.background, background.opacity) : "transparent",
    padding: px(background.paddingPx),
    borderRadius: px(background.radiusPx),
    WebkitTextStroke: outline.widthPx > 0 ? `${px(outline.widthPx)} ${colors.outline}` : undefined,
    paintOrder: "stroke fill",
    textShadow: hasShadow ? `${px(shadow.distancePx)} ${px(shadow.distancePx)} ${px(shadow.blurPx)} ${colors.shadow}` : undefined,
  };

  return { frame, block };
}

/** Style-picker preview: `scale` shrinks reference pixels to the preview size. */
export function previewStyleToCss(style: CaptionStyle, scale: number) {
  return styleToCss(style, {
    length: (value) => `${value * scale}px`,
    edgeOffset: (percent) => `${percent}%`,
  });
}
