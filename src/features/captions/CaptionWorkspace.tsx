"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CaptionEditor } from "@/components/captions/CaptionEditor";
import { useTranscription } from "@/hooks/useTranscription";
import { useCaptionStore, useProcessingStore } from "@/stores";
import type { ProcessingStage, Video } from "@/types";

const STAGE_LABEL: Partial<Record<ProcessingStage, string>> = {
  extracting_audio: "Extracting audio…",
  transcribing: "Transcribing… this can take a while for longer videos",
  processing_captions: "Finalizing captions…",
};

const ACTIVE_STAGES: ProcessingStage[] = ["extracting_audio", "transcribing", "processing_captions"];

/**
 * Full-width bottom workspace (UI revision — moved out of the narrow
 * right sidebar, where long sentences wrapped excessively and editing
 * felt cramped). Same trigger/progress/error responsibility as the
 * Phase 3 `TranscriptionPanel` this replaces; only the placement and
 * layout changed, not the underlying data flow
 * (`whisper.cpp → TranscriptionResult → CaptionDocument → Zustand →
 * CaptionEditor`, unchanged).
 */
export function CaptionWorkspace({ video }: { video: Video }) {
  const transcription = useProcessingStore((state) => state.transcription);
  const captionDocument = useCaptionStore((state) => state.captionDocument);
  const { generateCaptions } = useTranscription();

  if (video.metadata && !video.metadata.hasAudio) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        This video has no audio track, so captions can&apos;t be generated.
      </div>
    );
  }

  const isActive = ACTIVE_STAGES.includes(transcription.stage);
  const isDone = transcription.stage === "completed" || (captionDocument !== null && transcription.stage === "idle");
  const isFailed = transcription.stage === "failed";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Captions</h2>
        {!isActive && (
          <Button size="sm" onClick={() => void generateCaptions(video.id)}>
            {isDone ? "Regenerate captions" : "Generate captions"}
          </Button>
        )}
      </div>

      {isActive && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          <span>
            {transcription.stage === "extracting_audio" && transcription.progressPercent !== null
              ? `Extracting audio… ${transcription.progressPercent}%`
              : (STAGE_LABEL[transcription.stage] ?? "Working…")}
          </span>
        </div>
      )}

      {isFailed && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{transcription.error?.message ?? "Transcription failed."}</span>
        </div>
      )}

      {isDone && captionDocument && <CaptionEditor />}

      {!isDone && !isActive && !isFailed && (
        <p className="text-sm text-muted-foreground">
          No captions yet. Click &quot;Generate captions&quot; to transcribe this video.
        </p>
      )}
    </div>
  );
}
