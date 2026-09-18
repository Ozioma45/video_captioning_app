import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import { videoProcessor } from "@/services/video-processing/FfmpegVideoProcessor";
import { assertWhisperConfigured, whisperCppProvider } from "@/services/transcription/WhisperCppTranscriptionProvider";
import {
  MalformedTranscriptionResultError,
  TranscriptionProcessError,
  WhisperBinaryMissingError,
  WhisperModelMissingError,
  WhisperUnavailableError,
} from "@/services/transcription/errors";
import { AudioExtractionFailedError, FfmpegUnavailableError } from "@/services/video-processing/errors";
import { InsufficientTimestampDataError } from "@/domain/caption-engine/errors";
import { normalizeTranscription } from "@/domain/caption-engine/normalizeTranscription";
import { loadVideoRecord } from "@/services/videos/videoRecordStore";
import { saveCaptionDocument } from "@/services/captions/captionDocumentStore";
import {
  clearActiveProcess,
  loadTranscriptionJob,
  registerActiveProcess,
  saveTranscriptionJob,
  updateJob,
} from "./transcriptionJobStore";
import type { ProcessingError, TranscriptionJob } from "@/types";

function tempAudioKey(jobId: string): string {
  return `temp/${jobId}/audio.wav`;
}

function tempDirKey(jobId: string): string {
  return `temp/${jobId}`;
}

/**
 * Maps every failure mode this pipeline can hit to a clean, user-facing
 * `ProcessingError` (PROJECT.md §37: what happened / is the project safe
 * / never a raw technical string alone). Every branch is `projectSafe:
 * true` — nothing in this pipeline ever touches the source video or an
 * existing CaptionDocument; a failed job simply produces no new one
 * (CLAUDE.md "protect the user's project").
 */
function toProcessingError(error: unknown): ProcessingError {
  if (error instanceof WhisperBinaryMissingError || error instanceof WhisperModelMissingError) {
    return {
      message: "Local transcription isn't set up yet. See the project setup docs for whisper.cpp.",
      projectSafe: true,
      detail: error.message,
    };
  }
  if (error instanceof WhisperUnavailableError) {
    return {
      message: "The transcription engine could not be started. Please try again shortly.",
      projectSafe: true,
      detail: error.message,
    };
  }
  if (error instanceof TranscriptionProcessError) {
    return { message: "Transcription failed while processing the audio.", projectSafe: true, detail: error.message };
  }
  if (error instanceof MalformedTranscriptionResultError) {
    return {
      message: "Transcription produced an unexpected result and could not be used.",
      projectSafe: true,
      detail: error.message,
    };
  }
  if (error instanceof InsufficientTimestampDataError) {
    return { message: "Transcription did not produce usable timing data.", projectSafe: true, detail: error.message };
  }
  if (error instanceof FfmpegUnavailableError) {
    return {
      message: "Audio processing is temporarily unavailable. Please try again shortly.",
      projectSafe: true,
      detail: error.message,
    };
  }
  if (error instanceof AudioExtractionFailedError) {
    return { message: "Could not extract audio from this video.", projectSafe: true, detail: error.message };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { message: "Something went wrong while generating captions.", projectSafe: true, detail };
}

/**
 * Runs the full Phase 3 pipeline for one job: extract audio → transcribe
 * → normalize → persist. Not awaited by the route handler that starts it
 * (ARCHITECTURE.md §5 — nothing heavy runs synchronously in a
 * request/response cycle); the client polls the job record for progress.
 *
 * Structured as a single async function today (V1's in-process job model,
 * confirmed Unresolved Decision #14) but every step already goes through
 * the same `TranscriptionJob` record a real queue/worker would use, so
 * moving this behind one later doesn't require touching the pipeline
 * logic — only how it's *invoked*.
 */
export async function runTranscriptionJob(jobId: string): Promise<void> {
  const initialJob = await loadTranscriptionJob(jobId);
  if (!initialJob) {
    console.error(`[transcription] job ${jobId} disappeared before it could run`);
    return;
  }

  // A fresh, explicitly non-null binding: `job` is reassigned across
  // several awaits and read from inside a closure (the extractAudio
  // progress callback below), both of which make TypeScript widen a
  // narrowed-from-null `let` back to its declared union type.
  let job: TranscriptionJob = initialJob;

  try {
    // Fail fast: check whisper.cpp is actually set up *before* spending
    // time extracting audio for a transcription that can never run.
    await assertWhisperConfigured();

    const record = await loadVideoRecord(job.videoId);
    if (!record) {
      throw new Error("Source video record not found");
    }
    if (!record.metadata.hasAudio) {
      throw new Error("Source video has no audio track");
    }

    const videoAbsolutePath = storageProvider.getAbsolutePath(record.storageKey);
    const audioKey = tempAudioKey(jobId);
    const audioAbsolutePath = storageProvider.getAbsolutePath(audioKey);

    // extracting_audio
    await videoProcessor.extractAudio(videoAbsolutePath, audioAbsolutePath, {
      durationSeconds: record.metadata.durationSeconds,
      onProgress: (percent) => {
        void persist(job, { stage: "extracting_audio", progressPercent: percent });
      },
    });

    // transcribing — no live progress signal we can trust without a real
    // whisper.cpp binary to verify its streaming output against (see
    // ARCHITECTURE.md Phase 3 notes); an indeterminate state is the
    // honest choice here (PROJECT.md §38).
    job = await persist(job, { stage: "transcribing", progressPercent: null });
    const result = await whisperCppProvider.transcribe({
      audioFilePath: audioAbsolutePath,
      onProcessStart: (handle) => registerActiveProcess(jobId, handle),
    });
    clearActiveProcess(jobId);

    // processing_captions — normalize provider output into the domain model
    job = await persist(job, { stage: "processing_captions", progressPercent: null });
    const captionDocument = normalizeTranscription(job.videoId, result);
    await saveCaptionDocument(captionDocument);

    await persist(job, {
      stage: "completed",
      progressPercent: 100,
      captionDocumentId: captionDocument.id,
      error: null,
    });
  } catch (error) {
    clearActiveProcess(jobId);
    console.error(`[transcription] job ${jobId} failed:`, error);
    await persist(job, { stage: "failed", progressPercent: null, error: toProcessingError(error) });
  } finally {
    await storageProvider.delete(tempDirKey(jobId)).catch((cleanupError) => {
      console.error(`[transcription] failed to clean up temp files for job ${jobId}:`, cleanupError);
    });
  }
}

async function persist(job: TranscriptionJob, patch: Parameters<typeof updateJob>[1]): Promise<TranscriptionJob> {
  const next = updateJob(job, patch);
  await saveTranscriptionJob(next);
  return next;
}
