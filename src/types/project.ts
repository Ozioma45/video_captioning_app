/**
 * Project — the top-level, persisted unit (ARCHITECTURE.md §11).
 *
 * V1 persists one JSON file per project on the local filesystem; no
 * database. `Project` only holds references/ids and small config, never
 * video bytes or the full caption document inline (that's loaded
 * separately by id, keeping the project file small and fast to save).
 */

import type { VideoId } from "./video";
import type { CaptionDocumentId } from "./caption";
import type { CaptionStyleConfig } from "./style";
import type { AspectRatioPreset } from "./video";

export type ProjectId = string;

export interface ExportSettings {
  aspectRatio: AspectRatioPreset;
  /** Constant Rate Factor or equivalent quality target; provider-specific. */
  quality: "standard" | "high";
}

export interface Project {
  id: ProjectId;
  name: string;
  videoId: VideoId | null;
  captionDocumentId: CaptionDocumentId | null;
  styleConfig: CaptionStyleConfig | null;
  exportSettings: ExportSettings;
  createdAt: string;
  updatedAt: string;
}

export function createDefaultExportSettings(): ExportSettings {
  return { aspectRatio: "original", quality: "high" };
}
