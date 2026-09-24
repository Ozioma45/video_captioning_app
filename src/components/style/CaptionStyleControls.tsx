"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CAPTION_FONTS } from "@/domain/style-engine/fonts";
import { getStylePreset, isStyleModified } from "@/domain/style-engine/styleRegistry";
import { STYLE_LIMITS } from "@/domain/style-engine/validateStyle";
import { useStyleStore } from "@/stores";
import type {
  AnimationKind,
  CaptionFontId,
  FontWeight,
  HighlightMode,
  HorizontalPosition,
  TextTransform,
  VerticalPosition,
} from "@/types";
import { CaptionStylePreview } from "./CaptionStylePreview";
import { ColorField, ControlSection, SelectField, SliderField } from "./StyleFields";

const FONT_OPTIONS = CAPTION_FONTS.map((font) => ({ value: font.id as CaptionFontId, label: font.label }));
const WEIGHT_OPTIONS: { value: FontWeight; label: string }[] = [
  { value: 400, label: "Regular (400)" },
  { value: 500, label: "Medium (500)" },
  { value: 600, label: "Semibold (600)" },
  { value: 700, label: "Bold (700)" },
  { value: 800, label: "Extra bold (800)" },
  { value: 900, label: "Black (900)" },
];
const TRANSFORM_OPTIONS: { value: TextTransform; label: string }[] = [
  { value: "none", label: "As typed" },
  { value: "uppercase", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Capitalize" },
];
const HORIZONTAL_OPTIONS: { value: HorizontalPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const VERTICAL_OPTIONS: { value: VerticalPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
];
const HIGHLIGHT_OPTIONS: { value: HighlightMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "activeWord", label: "Active word" },
  { value: "emphasis", label: "Emphasized words" },
];
const ANIMATION_OPTIONS: { value: AnimationKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide", label: "Slide" },
  { value: "wordHighlight", label: "Word highlight" },
];

/**
 * Editable properties of the current project style. Every control maps to
 * a real field on `CaptionStyle` — controls that would be inert given
 * other settings (e.g. outline color at width 0) are hidden rather than
 * shown-but-dead (Phase 5 brief §9). All edits go through the store's
 * validated update path; nothing here touches captions, video, or the
 * server.
 */
export function CaptionStyleControls() {
  const config = useStyleStore((state) => state.styleConfig);
  const lastError = useStyleStore((state) => state.lastError);
  const updateStyle = useStyleStore((state) => state.updateStyle);
  const updateTypography = useStyleStore((state) => state.updateTypography);
  const updateColors = useStyleStore((state) => state.updateColors);
  const updatePosition = useStyleStore((state) => state.updatePosition);
  const resetStyle = useStyleStore((state) => state.resetStyle);

  const { style } = config;
  const modified = isStyleModified(config);
  const presetName = getStylePreset(config.baseStyleId)?.name ?? config.baseStyleId;
  const hasBackground = style.background.opacity > 0;
  const hasOutline = style.outline.widthPx > 0;
  const hasShadow = style.shadow.blurPx > 0 || style.shadow.distancePx > 0;
  const highlights = style.highlightMode !== "none";
  const L = STYLE_LIMITS;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <CaptionStylePreview style={style} scale={0.36} />
        <p className="text-xs text-muted-foreground">
          Style preview only — captions appear over the video in a later phase.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {presetName}
          {modified && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(modified)</span>}
        </span>
        <Button variant="ghost" size="sm" disabled={!modified} onClick={() => resetStyle()}>
          Reset to {presetName} defaults
        </Button>
      </div>

      {lastError && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{lastError}</span>
        </div>
      )}

      <ControlSection title="Typography">
        <SelectField label="Font" value={style.typography.fontFamily} options={FONT_OPTIONS} onChange={(fontFamily) => updateTypography({ fontFamily })} />
        <SliderField label="Size" value={style.typography.fontSize} min={L.fontSize.min} max={L.fontSize.max} unit="px" onChange={(fontSize) => updateTypography({ fontSize })} />
        <SelectField label="Weight" value={style.typography.fontWeight} options={WEIGHT_OPTIONS} onChange={(fontWeight) => updateTypography({ fontWeight })} />
        <SliderField label="Line height" value={style.typography.lineHeight} min={L.lineHeight.min} max={L.lineHeight.max} step={0.05} onChange={(lineHeight) => updateTypography({ lineHeight })} />
        <SliderField label="Letter spacing" value={style.typography.letterSpacing} min={L.letterSpacing.min} max={L.letterSpacing.max} unit="px" onChange={(letterSpacing) => updateTypography({ letterSpacing })} />
        <SelectField label="Text case" value={style.typography.textTransform} options={TRANSFORM_OPTIONS} onChange={(textTransform) => updateTypography({ textTransform })} />
      </ControlSection>

      <ControlSection title="Colors">
        <ColorField label="Text" value={style.colors.text} onChange={(text) => updateColors({ text })} />
        {highlights && <ColorField label="Highlight" value={style.colors.highlight} onChange={(highlight) => updateColors({ highlight })} />}
        {hasBackground && <ColorField label="Background" value={style.colors.background} onChange={(background) => updateColors({ background })} />}
        {hasOutline && <ColorField label="Outline" value={style.colors.outline} onChange={(outline) => updateColors({ outline })} />}
        {hasShadow && <ColorField label="Shadow" value={style.colors.shadow} onChange={(shadow) => updateColors({ shadow })} />}
      </ControlSection>

      <ControlSection title="Appearance">
        <SliderField label="Background opacity" value={style.background.opacity} min={L.backgroundOpacity.min} max={L.backgroundOpacity.max} step={0.05} onChange={(opacity) => updateStyle({ background: { opacity } })} />
        {hasBackground && (
          <>
            <SliderField label="Background padding" value={style.background.paddingPx} min={L.backgroundPaddingPx.min} max={L.backgroundPaddingPx.max} unit="px" onChange={(paddingPx) => updateStyle({ background: { paddingPx } })} />
            <SliderField label="Corner radius" value={style.background.radiusPx} min={L.backgroundRadiusPx.min} max={L.backgroundRadiusPx.max} unit="px" onChange={(radiusPx) => updateStyle({ background: { radiusPx } })} />
          </>
        )}
        <SliderField label="Outline thickness" value={style.outline.widthPx} min={L.outlineWidthPx.min} max={L.outlineWidthPx.max} unit="px" onChange={(widthPx) => updateStyle({ outline: { widthPx } })} />
        <SliderField label="Shadow blur" value={style.shadow.blurPx} min={L.shadowBlurPx.min} max={L.shadowBlurPx.max} unit="px" onChange={(blurPx) => updateStyle({ shadow: { blurPx } })} />
        <SliderField label="Shadow distance" value={style.shadow.distancePx} min={L.shadowDistancePx.min} max={L.shadowDistancePx.max} unit="px" onChange={(distancePx) => updateStyle({ shadow: { distancePx } })} />
      </ControlSection>

      <ControlSection title="Position">
        <SelectField label="Horizontal" value={style.position.horizontal} options={HORIZONTAL_OPTIONS} onChange={(horizontal) => updatePosition({ horizontal })} />
        <SelectField label="Vertical" value={style.position.vertical} options={VERTICAL_OPTIONS} onChange={(vertical) => updatePosition({ vertical })} />
        {style.position.vertical !== "center" && (
          <SliderField label="Distance from edge" value={style.position.offsetPercent} min={L.offsetPercent.min} max={L.offsetPercent.max} unit="%" onChange={(offsetPercent) => updatePosition({ offsetPercent })} />
        )}
        <SliderField label="Maximum width" value={style.position.maxWidthPercent} min={L.maxWidthPercent.min} max={L.maxWidthPercent.max} unit="%" onChange={(maxWidthPercent) => updatePosition({ maxWidthPercent })} />
        <SliderField label="Maximum lines" value={style.maxLines} min={L.maxLines.min} max={L.maxLines.max} onChange={(maxLines) => updateStyle({ maxLines })} />
      </ControlSection>

      <ControlSection title="Word highlight & animation">
        <SelectField label="Highlight" value={style.highlightMode} options={HIGHLIGHT_OPTIONS} onChange={(highlightMode) => updateStyle({ highlightMode })} />
        <SelectField label="Animation" value={style.animation.kind} options={ANIMATION_OPTIONS} onChange={(kind) => updateStyle({ animation: { kind } })} />
        <SliderField label="Animation duration" value={style.animation.durationMs} min={L.animationDurationMs.min} max={L.animationDurationMs.max} step={10} unit="ms" disabled={style.animation.kind === "none"} onChange={(durationMs) => updateStyle({ animation: { durationMs } })} />
      </ControlSection>
    </div>
  );
}
