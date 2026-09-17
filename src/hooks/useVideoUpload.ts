"use client";

import { useCallback } from "react";

import { useProcessingStore, useProjectStore } from "@/stores";
import type { Video } from "@/types";
import { UploadError, uploadVideoFile } from "@/features/upload/uploadClient";

/**
 * Drives the upload pipeline's client side, writing progress into the
 * existing `useProcessingStore` (not local component state) so any
 * component can observe it, and landing the result in `useProjectStore`
 * on success — the single source of truth for "what video is loaded"
 * (ARCHITECTURE.md §5, §12).
 */
export function useVideoUpload() {
  const setUploadState = useProcessingStore((state) => state.setState);
  const setVideo = useProjectStore((state) => state.setVideo);

  const upload = useCallback(
    async (file: File) => {
      const startedAt = new Date().toISOString();
      setUploadState("upload", { stage: "uploading", progressPercent: 0, startedAt, error: null });

      try {
        const { videoId, metadata } = await uploadVideoFile(file, (percent) => {
          if (percent >= 100) {
            // Bytes are fully sent; the server is now running ffprobe.
            // There's no finer-grained signal than that, so this is an
            // honest stage transition, not a fake percentage.
            setUploadState("upload", { stage: "processing_metadata", progressPercent: null, startedAt, error: null });
          } else {
            setUploadState("upload", { stage: "uploading", progressPercent: percent, startedAt, error: null });
          }
        });

        const video: Video = {
          id: videoId,
          source: { kind: "server-path", videoId },
          metadata,
          uploadedAt: new Date().toISOString(),
        };

        setVideo(video);
        setUploadState("upload", { stage: "completed", progressPercent: 100, startedAt, error: null });
      } catch (error) {
        const message = error instanceof UploadError ? error.message : "Something went wrong during upload.";
        setUploadState("upload", {
          stage: "failed",
          progressPercent: null,
          startedAt,
          error: { message, projectSafe: true, detail: error instanceof Error ? error.stack : undefined },
        });
      }
    },
    [setUploadState, setVideo],
  );

  return { upload };
}
