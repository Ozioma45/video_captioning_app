import { generateId } from "@/lib/id";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import type { StorageProvider } from "@/services/storage/StorageService";
import type { CancellableProcessHandle, ExportJob } from "@/types";

/**
 * Export job persistence and the in-process registry of running exports
 * (same V1 in-process job model as transcription, ARCHITECTURE.md §17:
 * one JSON file per job, no queue). Everything for one export lives under
 * `exports/<id>/` — `job.json`, the finished `output.mp4`, and a `work/`
 * directory that only exists while the render runs.
 */

export function exportDirectoryKey(exportId: string): string {
  return `exports/${exportId}`;
}
export function exportJobKey(exportId: string): string {
  return `exports/${exportId}/job.json`;
}
export function exportWorkDirectoryKey(exportId: string): string {
  return `exports/${exportId}/work`;
}
export function exportOutputKey(exportId: string): string {
  return `exports/${exportId}/output.mp4`;
}

export function createExportJob(videoId: string): ExportJob {
  const now = new Date().toISOString();
  const id = generateId();
  return {
    id,
    type: "export",
    videoId,
    status: "queued",
    progressPercent: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    output: null,
    downloadUrl: null,
  };
}

export async function saveExportJob(job: ExportJob, storage: StorageProvider = storageProvider): Promise<void> {
  await storage.save(exportJobKey(job.id), Buffer.from(JSON.stringify(job)));
}

export async function loadExportJob(exportId: string, storage: StorageProvider = storageProvider): Promise<ExportJob | null> {
  try {
    const buffer = await storage.read(exportJobKey(exportId));
    const job = JSON.parse(buffer.toString("utf-8")) as ExportJob;
    return job.type === "export" ? job : null;
  } catch {
    return null;
  }
}

export function updateExportJob(job: ExportJob, patch: Partial<Omit<ExportJob, "id" | "type" | "videoId" | "createdAt">>): ExportJob {
  return { ...job, ...patch, updatedAt: new Date().toISOString() };
}

/**
 * Running exports, keyed by export id. Kept on `globalThis` so the POST
 * route that starts an export and the cancel route that stops it see the
 * same registry even when the framework bundles each route separately.
 */
interface ActiveExport {
  cancelRequested: boolean;
  handle: CancellableProcessHandle | null;
}

const REGISTRY_KEY = Symbol.for("caption-studio.activeExports");
type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: Map<string, ActiveExport> };

function registry(): Map<string, ActiveExport> {
  const holder = globalThis as GlobalWithRegistry;
  return (holder[REGISTRY_KEY] ??= new Map());
}

export function registerActiveExport(exportId: string): void {
  registry().set(exportId, { cancelRequested: false, handle: null });
}
export function attachExportProcess(exportId: string, handle: CancellableProcessHandle): void {
  const entry = registry().get(exportId);
  if (!entry) return;
  entry.handle = handle;
  if (entry.cancelRequested) handle.cancel(); // cancel arrived before the process started
}
export function clearActiveExport(exportId: string): void {
  registry().delete(exportId);
}
export function isExportActive(exportId: string): boolean {
  return registry().has(exportId);
}
export function hasActiveExport(): boolean {
  return registry().size > 0;
}
export function isCancelRequested(exportId: string): boolean {
  return registry().get(exportId)?.cancelRequested === true;
}

/** Marks a running export cancelled and kills its FFmpeg process. Returns false if it isn't running in this process. */
export function requestExportCancel(exportId: string): boolean {
  const entry = registry().get(exportId);
  if (!entry) return false;
  entry.cancelRequested = true;
  entry.handle?.cancel();
  return true;
}
