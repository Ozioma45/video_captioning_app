"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_VIDEO_DURATION_SECONDS, MAX_VIDEO_FILE_SIZE_BYTES } from "@/config/limits";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVideoUpload } from "@/hooks/useVideoUpload";
import { useProcessingStore } from "@/stores";
import { createIdleProcessingState, type ProcessingStage } from "@/types";

import { validateVideoFileClientSide } from "./validateVideoFile";

const BUSY_STAGE_LABEL: Partial<Record<ProcessingStage, string>> = {
  processing_metadata: "Reading video metadata…",
};

const MAX_SIZE_LABEL = formatFileSize(MAX_VIDEO_FILE_SIZE_BYTES);
const MAX_DURATION_HOURS = MAX_VIDEO_DURATION_SECONDS / 3600;

/**
 * Upload UI (DESIGN_SYSTEM.md §7, §10-12): file picker, drag/drop, and
 * every state the Phase 2 brief asks for — empty, drag-over, selected,
 * validation-error, uploading, processing, failure. Success has no state
 * of its own here: once `useProjectStore.video` is set, the parent page
 * swaps this component out entirely for the player.
 */
export function UploadDropzone() {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useProcessingStore((state) => state.upload);
  const setUploadState = useProcessingStore((state) => state.setState);
  const { upload: startUpload } = useVideoUpload();

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const result = validateVideoFileClientSide(file);
      if (!result.valid) {
        setClientError(result.reason);
        setSelectedFileName(null);
        return;
      }
      setClientError(null);
      setSelectedFileName(file.name);
      void startUpload(file);
    },
    [startUpload],
  );

  function handleRetry() {
    setClientError(null);
    setSelectedFileName(null);
    setUploadState("upload", createIdleProcessingState());
    if (inputRef.current) inputRef.current.value = "";
  }

  const isBusy = upload.stage === "uploading" || upload.stage === "processing_metadata";

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDraggingOver(false);
        handleFile(event.dataTransfer.files?.[0]);
      }}
      className={cn(
        "w-full max-w-md rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-colors",
        isDraggingOver && "border-primary bg-secondary",
      )}
    >
      {!selectedFileName && !clientError && (
        <label htmlFor="video-upload-input" className="flex cursor-pointer flex-col items-center gap-3">
          <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">Drag and drop a video, or click to browse</span>
          <span className="text-xs text-muted-foreground">
            Up to {MAX_DURATION_HOURS} hours / {MAX_SIZE_LABEL}
          </span>
          <input
            id="video-upload-input"
            ref={inputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </label>
      )}

      {clientError && (
        <div className="flex flex-col items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
          <p className="text-sm text-destructive">{clientError}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            Choose another file
          </Button>
        </div>
      )}

      {selectedFileName && upload.stage !== "failed" && (
        <div className="flex flex-col items-center gap-3">
          {isBusy && <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />}
          <p className="max-w-full truncate text-sm font-medium">{selectedFileName}</p>
          <p className="text-xs text-muted-foreground">
            {upload.stage === "uploading" && upload.progressPercent !== null
              ? `Uploading… ${upload.progressPercent}%`
              : (BUSY_STAGE_LABEL[upload.stage] ?? "Working…")}
          </p>
        </div>
      )}

      {selectedFileName && upload.stage === "failed" && (
        <div className="flex flex-col items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
          <p className="text-sm text-destructive">{upload.error?.message ?? "Upload failed."}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
