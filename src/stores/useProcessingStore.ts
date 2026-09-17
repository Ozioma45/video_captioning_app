/**
 * Processing/job state shell (ARCHITECTURE.md §5, §13; PROJECT.md §38-39).
 *
 * Transient, per-pipeline-stage state — deliberately kept separate from
 * persistent project/domain state (CLAUDE.md, PROJECT.md §36). No job
 * polling or real progress reporting exists yet; that arrives with the
 * job runner in Phase 3.
 */

import { create } from "zustand";
import { createIdleProcessingState, type ProcessingState } from "@/types";

export type ProcessingKind = "upload" | "transcription" | "rendering";

interface ProcessingStoreState {
  upload: ProcessingState;
  transcription: ProcessingState;
  rendering: ProcessingState;
  setState: (kind: ProcessingKind, next: ProcessingState) => void;
  resetAll: () => void;
}

const initial = {
  upload: createIdleProcessingState(),
  transcription: createIdleProcessingState(),
  rendering: createIdleProcessingState(),
};

export const useProcessingStore = create<ProcessingStoreState>((set) => ({
  ...initial,
  setState: (kind, next) => set({ [kind]: next } as Pick<ProcessingStoreState, ProcessingKind>),
  resetAll: () => set(initial),
}));
