import type { CaptionStyle, CaptionStyleConfig, CaptionStyleId } from "@/types";
import { UnknownStyleError } from "./errors";
import { ALL_PRESETS } from "./stylePresets";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Central preset registry — the one place presets are listed and looked
 * up. UI components never hard-code a style; a new preset is added to
 * `stylePresets.ts` (`ALL_PRESETS`) and shows up everywhere.
 *
 * Presets are deep-frozen: an attempt to mutate one throws, so "editing a
 * preset" can only ever mean editing a clone (`createStyleConfig`).
 */
const PRESETS: readonly CaptionStyle[] = deepFreeze(ALL_PRESETS.map((preset) => structuredClone(preset)));

export const DEFAULT_STYLE_ID: CaptionStyleId = "classic";

export function listStylePresets(): readonly CaptionStyle[] {
  return PRESETS;
}

export function getStylePreset(styleId: CaptionStyleId): CaptionStyle | undefined {
  return PRESETS.find((preset) => preset.id === styleId);
}

/**
 * Starts a project style from a preset: a deep, unfrozen clone the user
 * can edit freely. Throws `UnknownStyleError` for an id that isn't in the
 * registry.
 */
export function createStyleConfig(styleId: CaptionStyleId): CaptionStyleConfig {
  const preset = getStylePreset(styleId);
  if (!preset) throw new UnknownStyleError(styleId);
  return { baseStyleId: preset.id, style: structuredClone(preset) };
}

/** True when the config differs from the preset it started from (drives "Reset"/"modified" UI). */
export function isStyleModified(config: CaptionStyleConfig): boolean {
  const preset = getStylePreset(config.baseStyleId);
  if (!preset) return true;
  return JSON.stringify(config.style) !== JSON.stringify(preset);
}
