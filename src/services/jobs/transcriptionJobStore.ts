import { generateId } from "@/lib/id";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import type { CancellableProcessHandle, TranscriptionJob } from "@/types";

/**
 * In-process job store (ARCHITECTURE.md §17, Unresolved Decision #14 —
 * confirmed: no queue/Redis in V1). One JSON file per job, same pattern
 * as `videoRecordStore`/`captionDocumentStore`.
 */
function jobKey(jobId: string): string {
  return `jobs/${jobId}.json`;
}

export function createTranscriptionJob(videoId: string): TranscriptionJob {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    type: "transcription",
    videoId,
    stage: "extracting_audio",
    progressPercent: null,
    createdAt: now,
    updatedAt: now,
    error: null,
    captionDocumentId: null,
  };
}

export async function saveTranscriptionJob(job: TranscriptionJob): Promise<void> {
  await storageProvider.save(jobKey(job.id), Buffer.from(JSON.stringify(job)));
}

export async function loadTranscriptionJob(jobId: string): Promise<TranscriptionJob | null> {
  try {
    const buffer = await storageProvider.read(jobKey(jobId));
    return JSON.parse(buffer.toString("utf-8")) as TranscriptionJob;
  } catch {
    return null;
  }
}

export function updateJob(
  job: TranscriptionJob,
  patch: Partial<Pick<TranscriptionJob, "stage" | "progressPercent" | "error" | "captionDocumentId">>,
): TranscriptionJob {
  return { ...job, ...patch, updatedAt: new Date().toISOString() };
}

/**
 * In-memory registry of currently-running whisper.cpp processes, keyed by
 * jobId. Exists solely so a future cancellation endpoint can find and
 * kill a running process without restructuring the job runner (Phase 3
 * brief §14) — no queue, no persistence, just a lookup table that only
 * matters while this Node process is alive (acceptable for the V1
 * in-process job model).
 */
const activeProcesses = new Map<string, CancellableProcessHandle>();

export function registerActiveProcess(jobId: string, handle: CancellableProcessHandle): void {
  activeProcesses.set(jobId, handle);
}

export function clearActiveProcess(jobId: string): void {
  activeProcesses.delete(jobId);
}

export function getActiveProcess(jobId: string): CancellableProcessHandle | undefined {
  return activeProcesses.get(jobId);
}
