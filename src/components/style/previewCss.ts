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

/**
 * Maps a structured `CaptionStyle` to inline CSS for the *style-picker
 * preview only* (Phase 5 brief §8). `scale` shrinks the 1080-line
 * reference pixel values to the preview's size. This is not the Phase 6
 * video overlay renderer — it's the only place style data becomes CSS,
 * and no CSS ever flows the other way into the style model.
 */
export function previewStyleToCss(
  style: CaptionStyle,
  scale: number,
): { frame: CSSProperties; block: CSSProperties } {
  const { typography, colors, background, outline, shadow, position } = style;
  const px = (value: number) => `${value * scale}px`;

  const frame: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    justifyContent: JUSTIFY[position.vertical],
    alignItems: ALIGN[position.horizontal],
    padding: position.vertical === "center" ? 0 : `${position.offsetPercent}% 6%`,
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
