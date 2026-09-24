import { ASS_FONT_SIZE_PER_CSS_PX } from "./exportFonts";
import type { CaptionStyle } from "@/types";

/** The reference frame height style pixel values are authored against (see `CaptionStyle`). */
export const REFERENCE_FRAME_HEIGHT = 1080;

/**
 * Horizontal padding, as a fraction of frame width, on each side of the
 * caption area. Mirrors the 6% side padding in `styleToCss`'s frame, so
 * the export's left/right anchoring and maximum width are computed from
 * the same numbers as the browser preview's.
 */
export const FRAME_SIDE_PADDING = 0.06;

export interface CaptionLayout {
  /** Scale from reference pixels to output pixels (video height / 1080). */
  scale: number;
  /** The CSS-equivalent em size in output pixels (what the preview draws). */
  fontPx: number;
  /** The libass font size producing the same visual size (see exportFonts.ts). */
  assFontSize: number;
  letterSpacingPx: number;
  /** ASS `\bord`: CSS strokes are centered on the glyph edge, ASS outlines grow outward, hence half. */
  outlinePx: number;
  shadowPx: number;
  boxPaddingPx: number;
  hasBox: boolean;
  /** ASS numpad alignment 1–9 (1 bottom-left … 9 top-right). */
  alignment: number;
  /** Wrap area: text wraps inside [marginL, width − marginR]. */
  marginL: number;
  marginR: number;
  marginV: number;
  /** The point the caption block is anchored to, for `\move`. */
  anchor: { x: number; y: number };
  /** Text wrap width (block max width minus box padding). */
  textWidthPx: number;
}

/**
 * Turns a style + the ACTUAL video dimensions into export geometry. All
 * values derive from video width/height only (never a viewport), with the
 * same formulas the preview's CSS encodes:
 *
 * - sizes scale by `height / 1080` (preview: `cqh` units of the overlay,
 *   which is pinned to the video box);
 * - the block sits inside a frame padded 6% left/right and `offsetPercent`
 *   of the height top/bottom (no padding at all when vertically centered);
 * - block max width is `maxWidthPercent` of the padded frame's width, box
 *   padding included (`box-sizing: border-box`).
 */
export function computeCaptionLayout(style: CaptionStyle, width: number, height: number): CaptionLayout {
  const scale = height / REFERENCE_FRAME_HEIGHT;
  const { typography, background, outline, shadow, position } = style;

  const pad = background.paddingPx * scale;
  // The preview's frame drops ALL its padding — sides included — when the caption is
  // vertically centered (`styleToCss`), so the export mirrors that.
  const sidePadding = position.vertical === "center" ? 0 : FRAME_SIDE_PADDING;
  const frameWidth = width * (1 - 2 * sidePadding);
  const blockMaxWidth = (frameWidth * position.maxWidthPercent) / 100;
  const textWidthPx = Math.max(1, blockMaxWidth - 2 * pad);

  const sideEdge = width * sidePadding + pad;
  let marginL: number;
  let marginR: number;
  let x: number;
  if (position.horizontal === "left") {
    marginL = sideEdge;
    marginR = width - marginL - textWidthPx;
    x = marginL;
  } else if (position.horizontal === "right") {
    marginR = sideEdge;
    marginL = width - marginR - textWidthPx;
    x = width - marginR;
  } else {
    marginL = marginR = (width - textWidthPx) / 2;
    x = width / 2;
  }

  const offset = (height * position.offsetPercent) / 100 + pad;
  let marginV = 0;
  let y = height / 2;
  let row: 0 | 1 | 2 = 1; // 0 bottom, 1 middle, 2 top
  if (position.vertical === "bottom") {
    row = 0;
    marginV = offset;
    y = height - offset;
  } else if (position.vertical === "top") {
    row = 2;
    marginV = offset;
    y = offset;
  }

  const column = position.horizontal === "left" ? 0 : position.horizontal === "center" ? 1 : 2;
  const alignment = [1, 4, 7][row] + column;

  return {
    scale,
    fontPx: typography.fontSize * scale,
    assFontSize: typography.fontSize * scale * ASS_FONT_SIZE_PER_CSS_PX,
    letterSpacingPx: typography.letterSpacing * scale,
    outlinePx: (outline.widthPx * scale) / 2,
    shadowPx: shadow.distancePx * scale,
    boxPaddingPx: pad,
    hasBox: background.opacity > 0,
    alignment,
    marginL,
    marginR,
    marginV,
    anchor: { x, y },
    textWidthPx,
  };
}
