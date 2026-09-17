/**
 * Caption style configuration — data, not components (ARCHITECTURE.md §8).
 *
 * A `CaptionStyle` is a plain, JSON-serializable object. All V1 presets
 * (Classic, Karaoke, Dynamic, Highlight, Podcast) are instances of this
 * same type with different field values — there is no per-style component
 * or per-style renderer. Adding a new preset means adding a new
 * `CaptionStyle` value, not new code.
 *
 * `AnimationConfig` is a deliberately closed union: every member must have
 * a known, faithful ASS/libass equivalent so the preview and the exporter
 * never diverge (ARCHITECTURE.md §9-10). Do not add an animation kind here
 * without also confirming it can be expressed as an ASS tag.
 */

export type CaptionStyleId = string;

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

export interface TypographyConfig {
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  lineHeight: number;
}

export interface StrokeConfig {
  color: string;
  widthPx: number;
}

export interface ShadowConfig {
  color: string;
  blurPx: number;
  offsetXPx: number;
  offsetYPx: number;
}

export type VerticalPosition = "top" | "center" | "bottom";
export type Alignment = "left" | "center" | "right";

export interface PositionConfig {
  vertical: VerticalPosition;
  /** 0-100, offset from the vertical anchor; 0 = at the anchor. */
  offsetPercent: number;
  alignment: Alignment;
}

export type AnimationKind = "none" | "fade" | "pop" | "slide" | "wordHighlight";

export interface AnimationConfig {
  kind: AnimationKind;
  durationMs: number;
}

export interface CaptionStyle {
  id: CaptionStyleId;
  name: string;
  typography: TypographyConfig;
  textColor: string;
  highlightColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  stroke?: StrokeConfig;
  shadow?: ShadowConfig;
  position: PositionConfig;
  animation: AnimationConfig;
  maxLines: number;
}

/**
 * A style as actually applied to a project: a base preset plus a sparse
 * set of user overrides, merged at resolve-time (base <- overrides). This
 * is what lets a user tweak one field of "Classic" without forking the
 * whole preset.
 */
export interface CaptionStyleConfig {
  baseStyleId: CaptionStyleId;
  overrides: Partial<CaptionStyle>;
}
