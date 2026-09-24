import type { CaptionFontId } from "@/types";

export interface CaptionFontDefinition {
  id: CaptionFontId;
  label: string;
  /**
   * CSS stack for the browser-side preview only. `--font-inter` is the
   * variable set by the self-hosted Inter in `app/layout.tsx` — there is
   * deliberately no remote font host anywhere in this registry (a live
   * Google Fonts fetch caused a real build failure; see
   * `app/fonts/README.md`).
   */
  cssStack: string;
  source: "self-hosted" | "system";
}

/**
 * The only fonts a caption style can name. Adding one means adding it to
 * `CaptionFontId` and here — never accepting a free-form string.
 *
 * Phase 7 note: the exporter (libass) resolves fonts by family name from
 * the machine/fontconfig, so `inter` will need the bundled
 * `app/fonts/Inter-Variable.woff2` (or an installed Inter) at export time.
 * Not addressed in Phase 5.
 */
export const CAPTION_FONTS: readonly CaptionFontDefinition[] = Object.freeze([
  { id: "inter", label: "Inter", cssStack: 'var(--font-inter), system-ui, sans-serif', source: "self-hosted" },
  { id: "system-sans", label: "System Sans", cssStack: "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif", source: "system" },
  { id: "system-serif", label: "System Serif", cssStack: "Georgia, 'Times New Roman', serif", source: "system" },
  { id: "system-mono", label: "System Mono", cssStack: "ui-monospace, Consolas, 'Courier New', monospace", source: "system" },
]);

export function isCaptionFontId(value: unknown): value is CaptionFontId {
  return typeof value === "string" && CAPTION_FONTS.some((font) => font.id === value);
}

export function getCaptionFont(id: CaptionFontId): CaptionFontDefinition {
  return CAPTION_FONTS.find((font) => font.id === id) ?? CAPTION_FONTS[0];
}
