import type { CaptionStyle, CaptionStyleConfig, CaptionStylePatch } from "@/types";
import { InvalidStyleError } from "./errors";
import { createStyleConfig } from "./styleRegistry";
import { validateCaptionStyle } from "./validateStyle";

const GROUPS = ["typography", "colors", "background", "outline", "shadow", "position", "animation"] as const;

/**
 * Applies a patch to a style and returns a new one (input untouched).
 * Groups the patch doesn't mention keep their object identity. Throws
 * `InvalidStyleError` — without producing a partial result — if the
 * patched style fails validation, so no out-of-range value can enter
 * state, whatever the UI sent.
 */
export function patchCaptionStyle(style: CaptionStyle, patch: CaptionStylePatch): CaptionStyle {
  const next: CaptionStyle = { ...style };

  for (const group of GROUPS) {
    const groupPatch = patch[group];
    if (groupPatch) {
      (next as unknown as Record<string, unknown>)[group] = { ...style[group], ...groupPatch };
    }
  }
  if (patch.highlightMode !== undefined) next.highlightMode = patch.highlightMode;
  if (patch.maxLines !== undefined) next.maxLines = patch.maxLines;

  const issues = validateCaptionStyle(next);
  if (issues.length > 0) {
    throw new InvalidStyleError(issues.map((issue) => `${issue.path} ${issue.message}`));
  }
  return next;
}

export function updateStyleConfig(config: CaptionStyleConfig, patch: CaptionStylePatch): CaptionStyleConfig {
  return { ...config, style: patchCaptionStyle(config.style, patch) };
}

/** Discards edits by re-cloning the config's own preset. */
export function resetStyleConfig(config: CaptionStyleConfig): CaptionStyleConfig {
  return createStyleConfig(config.baseStyleId);
}
