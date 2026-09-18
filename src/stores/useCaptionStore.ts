/**
 * Caption document state (ARCHITECTURE.md §7; Phase 4).
 *
 * Holds the current `CaptionDocument` and which segment is selected.
 * Every mutation delegates to the pure functions in
 * `domain/caption-engine/captionMutations.ts` — this store is thin
 * wiring (state + error surfacing), not where editing logic lives
 * (CLAUDE.md "avoid putting complicated caption manipulation logic
 * directly inside React components/stores").
 */

import { create } from "zustand";
import type { CaptionDocument, CaptionSegmentId } from "@/types";
import {
  mergeCaptions,
  splitCaption,
  updateCaptionText,
  updateCaptionTiming,
} from "@/domain/caption-engine/captionMutations";
import { useProjectStore } from "./useProjectStore";

interface CaptionState {
  captionDocument: CaptionDocument | null;
  selectedSegmentId: CaptionSegmentId | null;
  /** Last domain-mutation failure, for UI feedback. Cleared on the next successful mutation. */
  lastError: string | null;
  setCaptionDocument: (doc: CaptionDocument | null) => void;
  selectSegment: (segmentId: CaptionSegmentId | null) => void;
  selectNextCaption: () => void;
  selectPreviousCaption: () => void;
  updateText: (segmentId: CaptionSegmentId, text: string) => void;
  updateTiming: (segmentId: CaptionSegmentId, startTime: number, endTime: number) => void;
  split: (segmentId: CaptionSegmentId, splitIndex: number) => void;
  merge: (firstSegmentId: CaptionSegmentId, secondSegmentId: CaptionSegmentId) => void;
  reset: () => void;
}

export const useCaptionStore = create<CaptionState>((set, get) => ({
  captionDocument: null,
  selectedSegmentId: null,
  lastError: null,

  setCaptionDocument: (captionDocument) => set({ captionDocument, selectedSegmentId: null, lastError: null }),
  selectSegment: (selectedSegmentId) => set({ selectedSegmentId }),

  selectNextCaption: () => {
    const { captionDocument, selectedSegmentId } = get();
    const segments = captionDocument?.segments ?? [];
    if (segments.length === 0) return;

    const currentIndex = segments.findIndex((s) => s.id === selectedSegmentId);
    const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, segments.length - 1);
    set({ selectedSegmentId: segments[nextIndex].id });
  },

  selectPreviousCaption: () => {
    const { captionDocument, selectedSegmentId } = get();
    const segments = captionDocument?.segments ?? [];
    if (segments.length === 0) return;

    const currentIndex = segments.findIndex((s) => s.id === selectedSegmentId);
    const previousIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
    set({ selectedSegmentId: segments[previousIndex].id });
  },

  updateText: (segmentId, text) => {
    const { captionDocument } = get();
    if (!captionDocument) return;
    try {
      set({ captionDocument: updateCaptionText(captionDocument, segmentId, text), lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not update caption text." });
    }
  },

  updateTiming: (segmentId, startTime, endTime) => {
    const { captionDocument } = get();
    if (!captionDocument) return;
    const videoDurationSeconds = useProjectStore.getState().video?.metadata?.durationSeconds;
    try {
      set({
        captionDocument: updateCaptionTiming(captionDocument, segmentId, startTime, endTime, videoDurationSeconds),
        lastError: null,
      });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not update caption timing." });
    }
  },

  split: (segmentId, splitIndex) => {
    const { captionDocument } = get();
    if (!captionDocument) return;
    try {
      // The split segment is replaced in place by [first, second] — the
      // original index now holds `first`, so select that one.
      const originalIndex = captionDocument.segments.findIndex((s) => s.id === segmentId);
      const updated = splitCaption(captionDocument, segmentId, splitIndex);
      set({ captionDocument: updated, selectedSegmentId: updated.segments[originalIndex]?.id ?? null, lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not split this caption." });
    }
  },

  merge: (firstSegmentId, secondSegmentId) => {
    const { captionDocument } = get();
    if (!captionDocument) return;
    try {
      const firstIndex = captionDocument.segments.findIndex((s) => s.id === firstSegmentId);
      const updated = mergeCaptions(captionDocument, firstSegmentId, secondSegmentId);
      set({ captionDocument: updated, selectedSegmentId: updated.segments[firstIndex]?.id ?? null, lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Could not merge these captions." });
    }
  },

  reset: () => set({ captionDocument: null, selectedSegmentId: null, lastError: null }),
}));
