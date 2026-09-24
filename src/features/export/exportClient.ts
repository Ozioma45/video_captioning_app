import { useCaptionStore, useExportStore, useStyleStore } from "@/stores";
import type { ExportJob } from "@/types";

const POLL_INTERVAL_MS = 1000;

/**
 * Client side of the export job (POST /api/export → poll → download).
 * Polling lives at module level, not in a component, so switching the
 * inspector tab (which unmounts the export panel) doesn't stop tracking a
 * render that is still running on the server.
 */

let pollHandle: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

function applyJob(job: Omit<ExportJob, "error"> & { error: { message: string } | null }) {
  useExportStore.getState().set({
    status: job.status,
    progressPercent: job.progressPercent,
    startedAt: job.startedAt ?? useExportStore.getState().startedAt,
    error: job.error?.message ?? null,
    output: job.output ? { filename: job.output.filename, sizeBytes: job.output.sizeBytes } : null,
    downloadUrl: job.downloadUrl,
  });
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") stopPolling();
}

function startPolling(exportId: string) {
  stopPolling();
  pollHandle = setInterval(async () => {
    try {
      const response = await fetch(`/api/export/${exportId}`, { cache: "no-store" });
      if (!response.ok) return; // transient; keep polling
      applyJob(await response.json());
    } catch {
      // network blip — try again next tick
    }
  }, POLL_INTERVAL_MS);
}

export async function startExport(videoId: string): Promise<void> {
  const { captionDocument } = useCaptionStore.getState();
  const { styleConfig } = useStyleStore.getState();
  const set = useExportStore.getState().set;

  if (!captionDocument || captionDocument.segments.length === 0) {
    set({ status: "failed", error: "Generate captions before exporting.", videoId });
    return;
  }

  set({ exportId: null, videoId, status: "queued", progressPercent: null, startedAt: new Date().toISOString(), error: null, output: null, downloadUrl: null });

  try {
    // Only the fields the exporter reads: the current (edited) captions and style.
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, captionDocument: { segments: captionDocument.segments }, styleConfig }),
    });
    const body: { exportId?: string; error?: { message?: string } } | null = await response.json().catch(() => null);
    if (!response.ok || !body?.exportId) {
      set({ status: "failed", error: body?.error?.message ?? "Could not start the export." });
      return;
    }
    set({ exportId: body.exportId });
    startPolling(body.exportId);
  } catch {
    set({ status: "failed", error: "Could not reach the server to start the export." });
  }
}

export async function cancelExport(): Promise<void> {
  const { exportId } = useExportStore.getState();
  if (!exportId) return;
  try {
    await fetch(`/api/export/${exportId}/cancel`, { method: "POST" });
  } catch {
    // the next poll reports whatever actually happened
  }
}

export function resetExport(): void {
  stopPolling();
  useExportStore.getState().reset();
}
