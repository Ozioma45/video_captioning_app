"use client";

import { useCallback, useEffect, useRef } from "react";

import { useCaptionStore, useProcessingStore } from "@/stores";
import type { CaptionDocument, TranscriptionJob } from "@/types";

const POLL_INTERVAL_MS = 1500;

class TranscribeRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "TranscribeRequestError";
  }
}

async function requestTranscription(videoId: string): Promise<{ jobId: string }> {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId }),
  });
  const body: { jobId?: string; error?: { message?: string; code?: string } } | null = await response
    .json()
    .catch(() => null);

  if (!response.ok || !body?.jobId) {
    throw new TranscribeRequestError(body?.error?.message ?? "Could not start transcription.", body?.error?.code);
  }
  return { jobId: body.jobId };
}

async function fetchJob(jobId: string): Promise<TranscriptionJob | null> {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) return null;
  return (await response.json()) as TranscriptionJob;
}

async function fetchCaptionDocument(captionDocumentId: string): Promise<CaptionDocument | null> {
  const response = await fetch(`/api/captions/${captionDocumentId}`);
  if (!response.ok) return null;
  return (await response.json()) as CaptionDocument;
}

/**
 * Drives Phase 3's transcription pipeline from the client: kicks off a
 * job, then polls `GET /api/jobs/[jobId]` until it settles — the same
 * "write into the existing processing/caption stores" pattern
 * `useVideoUpload` established in Phase 2, not a parallel state system.
 */
export function useTranscription() {
  const setTranscriptionState = useProcessingStore((state) => state.setState);
  const setCaptionDocument = useCaptionStore((state) => state.setCaptionDocument);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollHandleRef.current !== null) {
      clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }, []);

  // Stop polling if the component unmounts mid-transcription.
  useEffect(() => stopPolling, [stopPolling]);

  const pollJob = useCallback(
    (jobId: string, startedAt: string) => {
      pollHandleRef.current = setInterval(async () => {
        const job = await fetchJob(jobId);
        if (!job) return;

        if (job.stage === "completed" && job.captionDocumentId) {
          stopPolling();
          const document = await fetchCaptionDocument(job.captionDocumentId);
          if (document) setCaptionDocument(document);
          setTranscriptionState("transcription", {
            stage: "completed",
            progressPercent: 100,
            startedAt,
            error: document ? null : { message: "The transcript could not be loaded.", projectSafe: true },
          });
          return;
        }

        if (job.stage === "failed") {
          stopPolling();
          setTranscriptionState("transcription", {
            stage: "failed",
            progressPercent: null,
            startedAt,
            error: job.error,
          });
          return;
        }

        setTranscriptionState("transcription", {
          stage: job.stage,
          progressPercent: job.progressPercent,
          startedAt,
          error: null,
        });
      }, POLL_INTERVAL_MS);
    },
    [setCaptionDocument, setTranscriptionState, stopPolling],
  );

  const generateCaptions = useCallback(
    async (videoId: string) => {
      stopPolling();
      const startedAt = new Date().toISOString();
      setTranscriptionState("transcription", {
        stage: "extracting_audio",
        progressPercent: null,
        startedAt,
        error: null,
      });

      try {
        const { jobId } = await requestTranscription(videoId);
        pollJob(jobId, startedAt);
      } catch (error) {
        const message = error instanceof TranscribeRequestError ? error.message : "Could not start transcription.";
        setTranscriptionState("transcription", {
          stage: "failed",
          progressPercent: null,
          startedAt,
          error: { message, projectSafe: true },
        });
      }
    },
    [pollJob, setTranscriptionState, stopPolling],
  );

  return { generateCaptions };
}
