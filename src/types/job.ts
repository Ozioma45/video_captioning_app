/**
 * Background job models. A job is the unit the client polls/subscribes to
 * for anything that must not block a request/response cycle
 * (ARCHITECTURE.md §5, §13). No job runner implementation exists yet —
 * these types are the contract Phase 3 (transcription) and Phase 7
 * (export) will implement against.
 */

import type { ProcessingStage, ProcessingError } from "./processing";
import type { CaptionStyleConfig } from "./style";

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

export interface RenderingJob extends BaseJob {
  type: "rendering";
  captionDocumentId: string;
  styleConfig: CaptionStyleConfig;
  outputPath: string | null;
}

export interface ExportJob extends BaseJob {
  type: "export";
  renderingJobId: string;
  downloadUrl: string | null;
}

export type Job = TranscriptionJob | RenderingJob | ExportJob;
