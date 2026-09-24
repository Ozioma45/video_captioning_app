/**
 * Caption style state (ARCHITECTURE.md §8; Phase 5).
 *
 * Holds the *project's* style configuration: a full clone of the selected
 * preset, freely editable (never the shared preset object itself). All
 * logic — cloning, patching, validation, reset — lives in the pure
 * functions under `domain/style-engine`; this store is thin wiring plus
 * error surfacing. Changing style only updates this state: nothing here
 * touches the video, transcription, FFmpeg, the caption document, or the
 * network (Phase 5 brief §25).
 */

import { create } from "zustand";
import type { CaptionStyleConfig, CaptionStyleId, CaptionStylePatch } from "@/types";
import { createStyleConfig, DEFAULT_STYLE_ID } from "@/domain/style-engine/styleRegistry";
import { resetStyleConfig, updateStyleConfig } from "@/domain/style-engine/updateStyle";

interface StyleState {
  styleConfig: CaptionStyleConfig;
  /** Last rejected change, for UI feedback. Cleared on the next successful change. */
  lastError: string | null;
  selectStyle: (styleId: CaptionStyleId) => void;
  updateStyle: (patch: CaptionStylePatch) => void;
  updateTypography: (patch: NonNullable<CaptionStylePatch["typography"]>) => void;
  updateColors: (patch: NonNullable<CaptionStylePatch["colors"]>) => void;
  updatePosition: (patch: NonNullable<CaptionStylePatch["position"]>) => void;
  /** Discards edits, returning to the selected preset's defaults. */
  resetStyle: () => void;
  /** Back to the app default (Classic). */
  reset: () => void;
}

export const useStyleStore = create<StyleState>((set, get) => ({
  styleConfig: createStyleConfig(DEFAULT_STYLE_ID),
  lastError: null,

  selectStyle: (styleId) => {
    try {
      set({ styleConfig: createStyleConfig(styleId), lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not select this style." });
    }
  },

  updateStyle: (patch) => {
    try {
      set({ styleConfig: updateStyleConfig(get().styleConfig, patch), lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not update the style." });
    }
  },

  updateTypography: (typography) => get().updateStyle({ typography }),
  updateColors: (colors) => get().updateStyle({ colors }),
  updatePosition: (position) => get().updateStyle({ position }),

  resetStyle: () => set({ styleConfig: resetStyleConfig(get().styleConfig), lastError: null }),
  reset: () => set({ styleConfig: createStyleConfig(DEFAULT_STYLE_ID), lastError: null }),
}));
