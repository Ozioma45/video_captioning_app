"use client";

import { listStylePresets } from "@/domain/style-engine/styleRegistry";
import { cn } from "@/lib/utils";
import { useStyleStore } from "@/stores";
import { CaptionStylePreview } from "./CaptionStylePreview";

/**
 * Preset gallery. Lists whatever the registry contains — adding a preset
 * to the registry adds a card here with no UI change. Selecting one
 * clones it into the project's style config (never editing the preset).
 */
export function CaptionStyleSelector() {
  const selectedId = useStyleStore((state) => state.styleConfig.baseStyleId);
  const selectStyle = useStyleStore((state) => state.selectStyle);

  return (
    <div role="group" aria-label="Caption style presets" className="grid grid-cols-2 gap-2">
      {listStylePresets().map((preset) => {
        const isSelected = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => selectStyle(preset.id)}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-primary bg-secondary ring-1 ring-primary" : "border-border bg-card hover:border-muted-foreground/50",
            )}
          >
            <CaptionStylePreview style={preset} sampleText="Caption style sample" scale={0.2} />
            <span className="px-0.5 text-xs font-medium">{preset.name}</span>
          </button>
        );
      })}
    </div>
  );
}
