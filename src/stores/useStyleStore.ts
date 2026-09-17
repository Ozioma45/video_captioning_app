/**
 * Style selection state shell (ARCHITECTURE.md §8).
 *
 * Holds which preset is selected plus sparse overrides — never a forked
 * copy of the whole style. Style *resolution* (base + overrides -> a
 * renderable style) is a domain-layer pure function introduced in Phase 5,
 * not something this store computes itself.
 */

import { create } from "zustand";
import type { CaptionStyleConfig, CaptionStyle } from "@/types";

interface StyleState {
  styleConfig: CaptionStyleConfig | null;
  selectBaseStyle: (baseStyleId: string) => void;
  setOverride: <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]) => void;
  clearOverrides: () => void;
  reset: () => void;
}

export const useStyleStore = create<StyleState>((set) => ({
  styleConfig: null,
  selectBaseStyle: (baseStyleId) => set({ styleConfig: { baseStyleId, overrides: {} } }),
  setOverride: (key, value) =>
    set((state) =>
      state.styleConfig
        ? { styleConfig: { ...state.styleConfig, overrides: { ...state.styleConfig.overrides, [key]: value } } }
        : state,
    ),
  clearOverrides: () =>
    set((state) => (state.styleConfig ? { styleConfig: { ...state.styleConfig, overrides: {} } } : state)),
  reset: () => set({ styleConfig: null }),
}));
