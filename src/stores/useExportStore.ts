/**
 * Export job state (Phase 7) — lightweight only: ids, status, progress,
 * error, and the finished file's metadata + download URL. Never the caption
 * document, the video, or the rendered file (CLAUDE.md "never put huge
 * blobs in state"). The rendering itself happens server-side; this store
 * mirrors the job record the client polls.
 */

import { create } from "zustand";
import type { ExportStatus } from "@/types";

export type ExportUiStatus = "idle" | ExportStatus;

interface ExportState {
  exportId: string | null;
  /** The video the current/last export belongs to, so a different video doesn't show its state. */
  videoId: string | null;
  status: ExportUiStatus;
  progressPercent: number | null;
  startedAt: string | null;
  error: string | null;
  output: { filename: string; sizeBytes: number } | null;
  downloadUrl: string | null;
  set: (patch: Partial<Omit<ExportState, "set" | "reset">>) => void;
  reset: () => void;
}

const initial = {
  exportId: null,
  videoId: null,
  status: "idle" as ExportUiStatus,
  progressPercent: null,
  startedAt: null,
  error: null,
  output: null,
  downloadUrl: null,
};

export const useExportStore = create<ExportState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set(initial),
}));
