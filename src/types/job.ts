/**
 * Background job models. A job is the unit the client polls/subscribes to
 * for anything that must not block a request/response cycle
 * (ARCHITECTURE.md §5, §13). No job runner implementation exists yet —
 * these types are the contract Phase 3 (transcription) and Phase 7
 * (export) will implement against.
 */

import type { ProcessingStage, ProcessingError } from "./processing";

export type JobId = string;

interface BaseJob {
  id: JobId;
  videoId: string;
  stage: ProcessingStage;
  progressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  error: ProcessingError | null;
}

export interface TranscriptionJob extends BaseJob {
  type: "transcription";
  captionDocumentId: string | null;
}

export type ExportStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

/**
 * Burned-in caption export (Phase 7). Deliberately its own status
 * vocabulary — an export can be cancelled and is queued before it runs,
 * neither of which the transcription `ProcessingStage` models. Only
 * lightweight state lives here: never the caption document, the video, or
 * the rendered file (see ARCHITECTURE.md §26).
 */
export interface ExportJob {
  id: JobId;
  type: "export";
  videoId: string;
  status: ExportStatus;
  /** 0-100 from FFmpeg's real `-progress` output; null until FFmpeg reports. 100 only after the output is validated. */
  progressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  /** Wall-clock start/end of the render, for elapsed time. */
  startedAt: string | null;
  finishedAt: string | null;
  error: ProcessingError | null;
  /** Set once the rendered file has been validated. */
  output: { filename: string; sizeBytes: number; durationSeconds: number } | null;
  /** Application download URL (never a filesystem path); set when completed. */
  downloadUrl: string | null;
}

export type Job = TranscriptionJob | ExportJob;
