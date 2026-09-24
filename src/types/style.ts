/**
 * Caption style model — data, not components (ARCHITECTURE.md §8).
 *
 * A `CaptionStyle` is a plain, JSON-serializable object of typed values —
 * never CSS strings, functions, or DOM objects — so it can be persisted
 * with a project and consumed by both the Phase 6 preview renderer and the
 * Phase 7 ASS exporter. The five presets (Classic, Karaoke, Dynamic,
 * Highlight, Podcast) are just instances of this one type.
 *
 * Deliberately *not* stored on `CaptionWord`/`CaptionSegment`: styling is
 * independent of transcript text and timing.
 *
 * Units: pixel values (`fontSize`, `paddingPx`, `widthPx`, ...) are relative
 * to a 1080-line reference frame; a renderer scales them by
 * `videoHeight / 1080`. Colors are always `#RRGGBB`.
 *
 * `AnimationKind` stays a deliberately closed union: every member must have
 * a faithful ASS/libass equivalent so preview and export never diverge
 * (ARCHITECTURE.md §9-10).
 */

export type CaptionStyleId = string;

/** `#RRGGBB` — the only color representation in the style model. */
export type HexColor = string;

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

/**
 * Fonts are chosen from a fixed registry (`domain/style-engine/fonts.ts`),
 * never a free-form CSS `font-family` string — no arbitrary CSS injection,
 * and no runtime dependency on a remote font host.
 */
export type CaptionFontId = "inter" | "system-sans" | "system-serif" | "system-mono";

export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export interface TypographyConfig {
  fontFamily: CaptionFontId;
  fontSize: number;
  fontWeight: FontWeight;
  /** Extra spacing between letters, px. */
  letterSpacing: number;
  /** Line height as a multiplier of font size. */
  lineHeight: number;
  textTransform: TextTransform;
}

export interface ColorConfig {
  text: HexColor;
  /**
   * Color of the highlighted word(s) — the *active* word for
   * `highlightMode: "activeWord"`, the *emphasized* word(s) for
   * `"emphasis"`. Ignored when `highlightMode` is `"none"`.
   */
  highlight: HexColor;
  background: HexColor;
  outline: HexColor;
  shadow: HexColor;
}

export interface BackgroundConfig {
  /** 0 = no background box, 1 = fully opaque. */
  opacity: number;
  paddingPx: number;
  radiusPx: number;
}

export interface OutlineConfig {
  /** 0 = no outline. */
  widthPx: number;
}

export interface ShadowConfig {
  /** Both 0 = no shadow. Distance maps to ASS `\shad`, blur to `\blur`. */
  blurPx: number;
  distancePx: number;
}

export type HorizontalPosition = "left" | "center" | "right";
export type VerticalPosition = "top" | "center" | "bottom";

export interface PositionConfig {
  /** Both the horizontal anchor of the caption block and its text alignment. */
  horizontal: HorizontalPosition;
  vertical: VerticalPosition;
  /** Distance in from the vertical edge, as a percent of frame height (ignored for `center`). */
  offsetPercent: number;
  /** Maximum caption block width, as a percent of frame width. */
  maxWidthPercent: number;
}

/**
 * How words are singled out. The style only *declares* the intent and the
 * colors; deciding *which* word is active at a given moment is the
 * renderer's job (`currentTime` vs `word.startTime`/`endTime`) — never the
 * style system's (Phase 5 brief §15).
 */
export type HighlightMode = "none" | "activeWord" | "emphasis";

export type AnimationKind = "none" | "fade" | "pop" | "slide" | "wordHighlight";

export interface AnimationConfig {
  kind: AnimationKind;
  durationMs: number;
}

export interface CaptionStyle {
  id: CaptionStyleId;
  name: string;
  typography: TypographyConfig;
  colors: ColorConfig;
  background: BackgroundConfig;
  outline: OutlineConfig;
  shadow: ShadowConfig;
  position: PositionConfig;
  highlightMode: HighlightMode;
  animation: AnimationConfig;
  maxLines: number;
}

/**
 * A style as applied to the current project: the preset it started from
 * plus a full *clone* of that preset's configuration, which the user edits.
 * The global preset object is never touched (Phase 5 brief §17); "reset"
 * simply re-clones the preset. `style` is always complete — no
 * merge-at-resolve-time step for a renderer to get wrong.
 */
export interface CaptionStyleConfig {
  baseStyleId: CaptionStyleId;
  style: CaptionStyle;
}

/** Fields a user may change (everything except identity). Group values are partial. */
export type CaptionStylePatch = {
  typography?: Partial<TypographyConfig>;
  colors?: Partial<ColorConfig>;
  background?: Partial<BackgroundConfig>;
  outline?: Partial<OutlineConfig>;
  shadow?: Partial<ShadowConfig>;
  position?: Partial<PositionConfig>;
  animation?: Partial<AnimationConfig>;
  highlightMode?: HighlightMode;
  maxLines?: number;
};
