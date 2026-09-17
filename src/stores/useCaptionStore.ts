/**
 * Caption document state shell (ARCHITECTURE.md §7).
 *
 * Holds the current `CaptionDocument` and which segment is selected in the
 * editor. No segmentation/editing logic lives here — that's the domain
 * layer (`domain/caption-engine`, introduced in Phase 4), which this store
 * will call into once it exists.
 */

import { create } from "zustand";
import type { CaptionDocument, CaptionSegmentId } from "@/types";

interface CaptionState {
  captionDocument: CaptionDocument | null;
  selectedSegmentId: CaptionSegmentId | null;
  setCaptionDocument: (doc: CaptionDocument | null) => void;
  selectSegment: (segmentId: CaptionSegmentId | null) => void;
  reset: () => void;
}

export const useCaptionStore = create<CaptionState>((set) => ({
  captionDocument: null,
  selectedSegmentId: null,
  setCaptionDocument: (captionDocument) => set({ captionDocument }),
  selectSegment: (selectedSegmentId) => set({ selectedSegmentId }),
  reset: () => set({ captionDocument: null, selectedSegmentId: null }),
}));
