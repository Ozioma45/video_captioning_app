/**
 * Processing/job state model (ARCHITECTURE.md §5, PROJECT.md §38-39).
 *
 * Every long-running operation (upload, transcription, render) is modeled
 * as a job with a real stage and, where the underlying process genuinely
 * reports one, a real percentage. There is no "fake percentage" state —
 * when exact progress isn't available, `progressPercent` stays `null` and
 * the UI shows the stage label instead (CLAUDE.md, PROJECT.md §38).
 */

export type ProcessingStage =
  | "idle"
  | "uploading"
  | "extracting_audio"
  | "transcribing"
  | "processing_captions"
  | "rendering"
  | "completed"
  | "failed";

export interface ProcessingError {
  /** Short, user-facing explanation — never a raw technical string alone. */
  message: string;
  /** Whether the user's project (source video/transcript/style) is intact. */
  projectSafe: boolean;
  /** Technical detail for debugging, not shown as the primary message. */
  detail?: string;
}

export interface ProcessingState {
  stage: ProcessingStage;
  /** 0-100 when the underlying process reports real progress, else null. */
  progressPercent: number | null;
  startedAt: string | null;
  error: ProcessingError | null;
}

export function createIdleProcessingState(): ProcessingState {
  return {
    stage: "idle",
    progressPercent: null,
    startedAt: null,
    error: null,
  };
}
