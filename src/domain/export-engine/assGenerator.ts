import type { CaptionSegment, CaptionStyle, HexColor } from "@/types";
import { buildCaptionTrack, type CaptionRun, type CaptionTrackEvent } from "./captionTrack";
import { computeCaptionLayout, type CaptionLayout } from "./captionLayout";
import { exportFontFamily, exportFontFileName } from "./exportFonts";

/**
 * Deterministic ASS (Advanced SubStation Alpha) generation for the libass
 * burn-in (ARCHITECTURE.md §10, §26): `segments + style + video size →
 * string`. Pure — no filesystem, no FFmpeg, no DOM, no clock; the input is
 * not mutated.
 *
 * Caption text is user-controlled and ends up inside a file libass parses,
 * so `escapeAssText` neutralizes everything libass would interpret
 * (override blocks, `\N`/`\h` escapes). It never reaches a command line.
 */

export interface AssVideoSize {
  width: number;
  height: number;
}

/** Escapes text for the ASS Text field (verified against the libass build in use). */
export function escapeAssText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, " ")
    // A backslash followed by N/n/h/{/} would form an escape. libass renders a
    // backslash followed by an invisible U+2060 WORD JOINER as a literal backslash.
    .replace(/\\/g, "\\⁠")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/** `#RRGGBB` → ASS `&HBBGGRR&`. Input is validated upstream; anything else becomes black. */
export function assColor(hex: HexColor): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "000000";
  const r = value.slice(0, 2);
  const g = value.slice(2, 4);
  const b = value.slice(4, 6);
  return `&H${b}${g}${r}&`.toUpperCase();
}

/** Opacity 0–1 → ASS alpha (`&H00&` opaque … `&HFF&` transparent). */
export function assAlpha(opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  return `&H${Math.round((1 - clamped) * 255).toString(16).padStart(2, "0")}&`.toUpperCase();
}

/** Seconds → `H:MM:SS.cc` (centiseconds, rounded — the same rounding for every boundary, so adjacent events meet exactly). */
export function assTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cs = totalCs % 100;
  const totalSeconds = (totalCs - cs) / 100;
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function entranceTags(style: CaptionStyle, layout: CaptionLayout): string {
  const { kind, durationMs } = style.animation;
  if (durationMs <= 0) return "";
  const d = Math.round(durationMs);
  if (kind === "fade") return `\\fad(${d},0)`;
  if (kind === "pop") return `\\fad(${d},0)\\fscx85\\fscy85\\t(0,${d},\\fscx100\\fscy100)`;
  if (kind === "slide") {
    const { x, y } = layout.anchor;
    const dy = 0.8 * layout.fontPx;
    const toTop = layout.alignment >= 7;
    const fromY = toTop ? y - dy : y + dy;
    return `\\fad(${d},0)\\move(${num(x)},${num(fromY)},${num(x)},${num(y)},0,${d})`;
  }
  return ""; // "none", "wordHighlight": no entrance motion
}

function runsToText(runs: readonly CaptionRun[], style: CaptionStyle): string {
  const base = assColor(style.colors.text);
  const highlight = assColor(style.colors.highlight);
  let out = "";
  let current: boolean | null = null;
  for (const run of runs) {
    if (run.highlighted !== current) {
      out += `{\\1c${run.highlighted ? highlight : base}}`;
      current = run.highlighted;
    }
    out += escapeAssText(run.text);
  }
  return out;
}

function dialogue(layer: number, event: CaptionTrackEvent, styleName: string, layout: CaptionLayout, tags: string, text: string): string {
  const [l, r, v] = [layout.marginL, layout.marginR, layout.marginV].map((value) => Math.round(value));
  return `Dialogue: ${layer},${assTime(event.startTime)},${assTime(event.endTime)},${styleName},,${l},${r},${v},,{${tags}}${text}`;
}

/**
 * Builds the complete ASS document. The event list comes from
 * `buildCaptionTrack`, so what is highlighted when is decided by the same
 * logic (and the same real word timestamps) as the preview.
 */
export function generateAss(segments: readonly CaptionSegment[], style: CaptionStyle, size: AssVideoSize): string {
  const layout = computeCaptionLayout(style, size.width, size.height);
  const track = buildCaptionTrack(segments, style);
  const family = exportFontFamily(style.typography.fontWeight);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    "WrapStyle: 1",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: None",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Text,${family},${num(layout.assFontSize)},${assColor(style.colors.text)},${assColor(style.colors.text)},${assColor(style.colors.outline)},${assColor(style.colors.shadow)},0,0,0,0,100,100,${num(layout.letterSpacingPx)},0,1,${num(layout.outlinePx)},${num(layout.shadowPx)},${layout.alignment},0,0,0,1`,
    `Style: Box,${family},${num(layout.assFontSize)},${assColor(style.colors.text)},${assColor(style.colors.text)},${assColor(style.colors.background)},${assColor(style.colors.background)},0,0,0,0,100,100,${num(layout.letterSpacingPx)},0,3,${num(layout.boxPaddingPx)},0,${layout.alignment},0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const lines: string[] = [];
  for (const event of track) {
    const anim = event.entrance ? entranceTags(style, layout) : "";
    const text = runsToText(event.runs, style);
    if (layout.hasBox) {
      // Layer 0: the box only (text and shadow fully transparent, box alpha = background opacity).
      const boxAlpha = assAlpha(style.background.opacity);
      lines.push(dialogue(0, event, "Box", layout, `\\1a&HFF&\\4a&HFF&\\3a${boxAlpha}${anim}`, text));
    }
    // Layer 1: the text with outline + shadow.
    lines.push(dialogue(1, event, "Text", layout, anim, text));
  }

  return [...header, ...lines, ""].join("\n");
}

/** The font files a style needs in libass's fonts directory. */
export function requiredFontFiles(style: CaptionStyle): string[] {
  return [exportFontFileName(style.typography.fontWeight)];
}
