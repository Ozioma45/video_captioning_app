import type { CaptionStyle } from "@/types";
import { isCaptionFontId } from "./fonts";

export interface StyleIssue {
  /** Dotted path into the style, e.g. `typography.fontSize`. */
  path: string;
  message: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900];
const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"];
const HORIZONTAL = ["left", "center", "right"];
const VERTICAL = ["top", "center", "bottom"];
const HIGHLIGHT_MODES = ["none", "activeWord", "emphasis"];
const ANIMATION_KINDS = ["none", "fade", "pop", "slide", "wordHighlight"];

/** Inclusive numeric ranges — the single source of truth the UI sliders also use. */
export const STYLE_LIMITS = {
  fontSize: { min: 12, max: 160 },
  letterSpacing: { min: -5, max: 20 },
  lineHeight: { min: 0.8, max: 2.5 },
  backgroundOpacity: { min: 0, max: 1 },
  backgroundPaddingPx: { min: 0, max: 60 },
  backgroundRadiusPx: { min: 0, max: 60 },
  outlineWidthPx: { min: 0, max: 12 },
  shadowBlurPx: { min: 0, max: 20 },
  shadowDistancePx: { min: 0, max: 20 },
  offsetPercent: { min: 0, max: 50 },
  maxWidthPercent: { min: 20, max: 100 },
  maxLines: { min: 1, max: 4 },
  animationDurationMs: { min: 0, max: 2000 },
} as const;

type Range = { min: number; max: number };

/**
 * Validates a complete style. Returns every problem found (empty = valid)
 * rather than throwing — callers decide whether to reject an edit. Never
 * trust values coming from UI inputs or persisted data.
 */
export function validateCaptionStyle(style: CaptionStyle): StyleIssue[] {
  const issues: StyleIssue[] = [];

  function number(path: string, value: unknown, range: Range) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ path, message: "must be a number" });
    } else if (value < range.min || value > range.max) {
      issues.push({ path, message: `must be between ${range.min} and ${range.max}` });
    }
  }
  function oneOf(path: string, value: unknown, allowed: unknown[]) {
    if (!allowed.includes(value)) issues.push({ path, message: `must be one of ${allowed.join(", ")}` });
  }
  function color(path: string, value: unknown) {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) issues.push({ path, message: "must be a #RRGGBB color" });
  }

  const { typography, colors, background, outline, shadow, position, animation } = style;

  if (!isCaptionFontId(typography?.fontFamily)) {
    issues.push({ path: "typography.fontFamily", message: "must be a known caption font" });
  }
  number("typography.fontSize", typography?.fontSize, STYLE_LIMITS.fontSize);
  oneOf("typography.fontWeight", typography?.fontWeight, FONT_WEIGHTS);
  number("typography.letterSpacing", typography?.letterSpacing, STYLE_LIMITS.letterSpacing);
  number("typography.lineHeight", typography?.lineHeight, STYLE_LIMITS.lineHeight);
  oneOf("typography.textTransform", typography?.textTransform, TEXT_TRANSFORMS);

  for (const key of ["text", "highlight", "background", "outline", "shadow"] as const) {
    color(`colors.${key}`, colors?.[key]);
  }

  number("background.opacity", background?.opacity, STYLE_LIMITS.backgroundOpacity);
  number("background.paddingPx", background?.paddingPx, STYLE_LIMITS.backgroundPaddingPx);
  number("background.radiusPx", background?.radiusPx, STYLE_LIMITS.backgroundRadiusPx);
  number("outline.widthPx", outline?.widthPx, STYLE_LIMITS.outlineWidthPx);
  number("shadow.blurPx", shadow?.blurPx, STYLE_LIMITS.shadowBlurPx);
  number("shadow.distancePx", shadow?.distancePx, STYLE_LIMITS.shadowDistancePx);

  oneOf("position.horizontal", position?.horizontal, HORIZONTAL);
  oneOf("position.vertical", position?.vertical, VERTICAL);
  number("position.offsetPercent", position?.offsetPercent, STYLE_LIMITS.offsetPercent);
  number("position.maxWidthPercent", position?.maxWidthPercent, STYLE_LIMITS.maxWidthPercent);

  oneOf("highlightMode", style.highlightMode, HIGHLIGHT_MODES);
  oneOf("animation.kind", animation?.kind, ANIMATION_KINDS);
  number("animation.durationMs", animation?.durationMs, STYLE_LIMITS.animationDurationMs);
  number("maxLines", style.maxLines, STYLE_LIMITS.maxLines);

  return issues;
}
