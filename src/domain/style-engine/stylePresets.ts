import type { CaptionStyle } from "@/types";

/**
 * The five V1 presets, as plain data. Values are starting points chosen
 * for the described purpose (Phase 5 brief §5), not product requirements —
 * tests assert structure and validity, not exact colors.
 *
 * Presets are deep-frozen by the registry; anything that wants to edit one
 * must clone it first (`createStyleConfig`).
 */

const BASE = {
  background: { opacity: 0, paddingPx: 0, radiusPx: 0 },
  outline: { widthPx: 2 },
  shadow: { blurPx: 2, distancePx: 1 },
  position: { horizontal: "center", vertical: "bottom", offsetPercent: 8, maxWidthPercent: 80 },
  maxLines: 2,
} as const;

/** Clean general-purpose subtitles; no motion; fine over long videos. */
export const CLASSIC: CaptionStyle = {
  id: "classic",
  name: "Classic",
  typography: { fontFamily: "inter", fontSize: 44, fontWeight: 600, letterSpacing: 0, lineHeight: 1.25, textTransform: "none" },
  colors: { text: "#FFFFFF", highlight: "#FFD54A", background: "#000000", outline: "#000000", shadow: "#000000" },
  background: { ...BASE.background },
  outline: { ...BASE.outline },
  shadow: { ...BASE.shadow },
  position: { ...BASE.position },
  highlightMode: "none",
  animation: { kind: "none", durationMs: 0 },
  maxLines: BASE.maxLines,
};

/** Word-synchronized: the spoken word is drawn in the highlight color. */
export const KARAOKE: CaptionStyle = {
  id: "karaoke",
  name: "Karaoke",
  typography: { fontFamily: "inter", fontSize: 48, fontWeight: 800, letterSpacing: 0, lineHeight: 1.25, textTransform: "none" },
  colors: { text: "#FFFFFF", highlight: "#FFD54A", background: "#000000", outline: "#000000", shadow: "#000000" },
  background: { ...BASE.background },
  outline: { widthPx: 3 },
  shadow: { ...BASE.shadow },
  position: { ...BASE.position },
  highlightMode: "activeWord",
  animation: { kind: "wordHighlight", durationMs: 80 },
  maxLines: BASE.maxLines,
};

/** Energetic short-form look: big, heavy, uppercase, popping words. */
export const DYNAMIC: CaptionStyle = {
  id: "dynamic",
  name: "Dynamic",
  typography: { fontFamily: "inter", fontSize: 68, fontWeight: 900, letterSpacing: 1, lineHeight: 1.1, textTransform: "uppercase" },
  colors: { text: "#FFFFFF", highlight: "#3DFFA2", background: "#000000", outline: "#000000", shadow: "#000000" },
  background: { ...BASE.background },
  outline: { widthPx: 5 },
  shadow: { blurPx: 0, distancePx: 3 },
  position: { horizontal: "center", vertical: "center", offsetPercent: 0, maxWidthPercent: 70 },
  highlightMode: "activeWord",
  animation: { kind: "pop", durationMs: 150 },
  maxLines: 2,
};

/** Emphasizes important words in an otherwise normal caption. */
export const HIGHLIGHT: CaptionStyle = {
  id: "highlight",
  name: "Highlight",
  typography: { fontFamily: "inter", fontSize: 46, fontWeight: 700, letterSpacing: 0, lineHeight: 1.25, textTransform: "none" },
  colors: { text: "#FFFFFF", highlight: "#FFD54A", background: "#000000", outline: "#000000", shadow: "#000000" },
  background: { ...BASE.background },
  outline: { widthPx: 2 },
  shadow: { ...BASE.shadow },
  position: { ...BASE.position },
  highlightMode: "emphasis",
  animation: { kind: "none", durationMs: 0 },
  maxLines: BASE.maxLines,
};

/** Calm and very readable for interviews and long-form talk. */
export const PODCAST: CaptionStyle = {
  id: "podcast",
  name: "Podcast",
  typography: { fontFamily: "inter", fontSize: 52, fontWeight: 500, letterSpacing: 0, lineHeight: 1.35, textTransform: "none" },
  colors: { text: "#FFFFFF", highlight: "#FFD54A", background: "#000000", outline: "#000000", shadow: "#000000" },
  background: { opacity: 0.55, paddingPx: 14, radiusPx: 10 },
  outline: { widthPx: 0 },
  shadow: { blurPx: 0, distancePx: 0 },
  position: { horizontal: "center", vertical: "bottom", offsetPercent: 8, maxWidthPercent: 75 },
  highlightMode: "none",
  animation: { kind: "fade", durationMs: 150 },
  maxLines: 2,
};

export const ALL_PRESETS: readonly CaptionStyle[] = [CLASSIC, KARAOKE, DYNAMIC, HIGHLIGHT, PODCAST];
