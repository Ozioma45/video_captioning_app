"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isFontExportFaithful } from "@/domain/export-engine/exportFonts";
import { cancelExport, resetExport, startExport } from "@/features/export/exportClient";
import { formatFileSize } from "@/lib/format";
import { useCaptionStore, useExportStore, useStyleStore } from "@/stores";
import type { Video } from "@/types";

function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Burned-in export: one button, honest progress from FFmpeg, cancel, and a
 * download link once the server has validated the file. Uses the caption
 * document and style exactly as they are in the editor right now.
 */
export function ExportPanel({ video }: { video: Video }) {
  const hasCaptions = useCaptionStore((state) => (state.captionDocument?.segments.length ?? 0) > 0);
  const fontId = useStyleStore((state) => state.styleConfig.style.typography.fontFamily);
  const exportState = useExportStore();
  const [now, setNow] = useState(() => Date.now());

  // Only this video's export is shown here.
  const status = exportState.videoId === video.id ? exportState.status : "idle";
  const running = status === "queued" || status === "processing";

  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [running]);

  return (
    <div id="inspector-panel-export" role="tabpanel" aria-labelledby="inspector-tab-export" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Export video</h2>

      {(status === "idle" || status === "cancelled") && (
        <>
          <p className="text-xs text-muted-foreground">
            Renders the captions as shown in the preview — your edits and the selected style — permanently into an MP4. Your original video is not changed.
          </p>
          {!isFontExportFaithful(fontId) && (
            <p className="text-xs text-muted-foreground">This style&apos;s font isn&apos;t bundled for export; captions will be exported in Inter.</p>
          )}
          {status === "cancelled" && <p className="text-sm text-muted-foreground">Export cancelled. Nothing was saved.</p>}
          <Button onClick={() => void startExport(video.id)} disabled={!hasCaptions || !video.metadata}>
            Export video
          </Button>
          {!hasCaptions && <p className="text-xs text-muted-foreground">Generate captions first.</p>}
        </>
      )}

      {running && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{status === "queued" ? "Starting export…" : "Exporting…"}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{formatElapsed(exportState.startedAt, now)}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Export progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportState.progressPercent ?? undefined}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${exportState.progressPercent ?? 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{exportState.progressPercent === null ? "Waiting for the renderer…" : `${exportState.progressPercent}%`}</span>
            <Button variant="secondary" size="sm" onClick={() => void cancelExport()}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {status === "completed" && exportState.downloadUrl && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            <span>Export complete</span>
          </div>
          {exportState.output && (
            <p className="break-all text-xs text-muted-foreground">
              {exportState.output.filename} · {formatFileSize(exportState.output.sizeBytes)}
            </p>
          )}
          <a
            href={exportState.downloadUrl}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </a>
          <Button variant="ghost" size="sm" onClick={resetExport}>
            Export again
          </Button>
        </>
      )}

      {status === "failed" && (
        <>
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{exportState.error ?? "The export failed."}</span>
          </div>
          <p className="text-xs text-muted-foreground">Your video, captions and style are unchanged.</p>
          <Button variant="secondary" onClick={resetExport}>
            Try again
          </Button>
        </>
      )}
    </div>
  );
}
