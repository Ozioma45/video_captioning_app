"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CaptionEditor } from "@/components/captions/CaptionEditor";
import { useTranscription } from "@/hooks/useTranscription";
import { useCaptionStore, useProcessingStore } from "@/stores";
import type { ProcessingStage, Video } from "@/types";

const STAGE_LABEL: Partial<Record<ProcessingStage, string>> = {
  extracting_audio: "Extracting audio…",
  transcribing: "Transcribing…",
  processing_captions: "Finalizing captions…",
};

const ACTIVE_STAGES: ProcessingStage[] = ["extracting_audio", "transcribing", "processing_captions"];

function formatElapsed(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.round((nowMs - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

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

  const isActive = ACTIVE_STAGES.includes(transcription.stage);
  const isDone = transcription.stage === "completed" || (captionDocument !== null && transcription.stage === "idle");
  const isFailed = transcription.stage === "failed";

  // Tick once a second only while something is actually running, so the
  // "elapsed" fallback below stays honest without polling job status any
  // faster than useTranscription already does. Hooks must run
  // unconditionally, so this stays above the no-audio early return below.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [isActive]);

  if (video.metadata && !video.metadata.hasAudio) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        This video has no audio track, so captions can&apos;t be generated.
      </div>
    );
  }

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
            {/* Real progress when the stage reports one (extraction: ffmpeg
                `-progress`; transcription: whisper.cpp's own `-pp` callback —
                see WhisperCppTranscriptionProvider). Never a fabricated
                percentage — when neither pipeline has reported one yet, show
                the stage and how long it's actually been running instead. */}
            {transcription.progressPercent !== null
              ? `${STAGE_LABEL[transcription.stage] ?? "Working…"} ${transcription.progressPercent}%`
              : `${STAGE_LABEL[transcription.stage] ?? "Working…"}${
                  transcription.startedAt ? ` (${formatElapsed(transcription.startedAt, now)} elapsed)` : ""
                }`}
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
