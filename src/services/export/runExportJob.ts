import { copyFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateAss, requiredFontFiles } from "@/domain/export-engine/assGenerator";
import type { ExportRequest } from "@/domain/export-engine/exportRequest";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import type { StorageProvider } from "@/services/storage/StorageService";
import { videoProcessor } from "@/services/video-processing/FfmpegVideoProcessor";
import type { VideoProcessor } from "@/services/video-processing/VideoProcessingService";
import { FfmpegUnavailableError, RenderFailedError } from "@/services/video-processing/errors";
import { loadVideoRecord, type StoredVideoRecord } from "@/services/videos/videoRecordStore";
import { sanitizeDisplayFilename } from "@/lib/sanitize";
import type { ExportJob, ProcessingError } from "@/types";
import {
  attachExportProcess,
  clearActiveExport,
  exportOutputKey,
  exportWorkDirectoryKey,
  isCancelRequested,
  loadExportJob,
  saveExportJob,
  updateExportJob,
} from "./exportJobStore";
import { ExportCancelledError, ExportFontMissingError, ExportOutputInvalidError, ExportSourceInvalidError } from "./errors";
import { toEvenSize, validateExportOutput } from "./validateExportOutput";

const SUBTITLE_FILE = "captions.ass";
const FONTS_DIRECTORY = "fonts";
const RENDER_FILE = "render.mp4";

export interface ExportDependencies {
  storage: StorageProvider & { getAbsolutePath(key: string): string };
  processor: VideoProcessor;
  loadVideo: (videoId: string) => Promise<StoredVideoRecord | null>;
  /** Directory holding the bundled export fonts (see exportFonts.ts). */
  fontsSourceDirectory: string;
}

export function defaultExportDependencies(): ExportDependencies {
  return {
    storage: storageProvider,
    processor: videoProcessor,
    loadVideo: loadVideoRecord,
    fontsSourceDirectory: path.resolve(process.cwd(), "assets", "fonts"),
  };
}

/**
 * Maps every failure mode of the export pipeline to a user-facing
 * `ProcessingError` (PROJECT.md §37): what happened, is the project safe,
 * never a raw path or stack. Every branch is `projectSafe: true` — this
 * pipeline only reads the source video and writes under `exports/<id>/`.
 * `detail` keeps a short technical reason for diagnostics.
 */
export function toExportError(error: unknown): ProcessingError {
  if (error instanceof FfmpegUnavailableError) {
    return { message: "The video renderer could not be started. Please try again shortly.", projectSafe: true, detail: error.message };
  }
  if (error instanceof ExportFontMissingError) {
    return { message: "Export isn't set up correctly on this server (a caption font is missing).", projectSafe: true, detail: error.message };
  }
  if (error instanceof ExportOutputInvalidError) {
    return { message: "The exported video didn't pass verification, so it was discarded. Please try again.", projectSafe: true, detail: error.message };
  }
  if (error instanceof RenderFailedError) {
    return { message: "The video could not be rendered with captions.", projectSafe: true, detail: error.message };
  }
  if (error instanceof ExportSourceInvalidError) {
    return { message: "The source video can't be exported.", projectSafe: true, detail: error.message };
  }
  return { message: "Something went wrong while exporting the video.", projectSafe: true, detail: error instanceof Error ? error.name : "UnknownError" };
}

/** `My Talk.mov` → `My Talk-captioned.mp4` (display name only; never used as a path). */
export function exportDownloadFilename(originalFilename: string): string {
  const base = sanitizeDisplayFilename(originalFilename).replace(/\.[^./\\]+$/, "").trim() || "video";
  return `${base}-captioned.mp4`;
}

/**
 * Runs one export: ASS generation → FFmpeg burn-in → output validation →
 * completed. Not awaited by the route (nothing heavy in a request cycle);
 * the client polls the job record.
 *
 * Guarantees:
 * - a job is `completed` (and 100%) only after ffprobe validated the file;
 * - the `work/` directory (ASS, fonts copy, partial render) is removed in
 *   `finally`, on success, failure and cancellation alike;
 * - a failed or cancelled export leaves no `output.mp4` behind;
 * - the source video and the caller's caption/style data are only read.
 */
export async function runExportJob(
  jobId: string,
  request: ExportRequest,
  deps: ExportDependencies = defaultExportDependencies(),
): Promise<void> {
  const { storage } = deps;
  const initial = await loadExportJob(jobId, storage);
  if (!initial) {
    console.error(`[export] job ${jobId} disappeared before it could run`);
    clearActiveExport(jobId);
    return;
  }

  let job: ExportJob = initial;
  let lastWrite: Promise<void> = Promise.resolve();
  const persist = (patch: Parameters<typeof updateExportJob>[1]): void => {
    job = updateExportJob(job, patch);
    const snapshot = job;
    // Writes are chained so an older progress snapshot can never land after a newer one.
    lastWrite = lastWrite.then(() => saveExportJob(snapshot, storage)).catch((error) => console.error(`[export] could not persist job ${jobId}:`, error));
  };

  const workKey = exportWorkDirectoryKey(jobId);
  const outputKey = exportOutputKey(jobId);
  let completed = false;

  try {
    persist({ status: "processing", startedAt: new Date().toISOString(), progressPercent: 0 });

    const record = await deps.loadVideo(request.videoId);
    if (!record) throw new ExportSourceInvalidError("Source video record not found");
    const { metadata } = record;
    if (!(metadata.width > 0 && metadata.height > 0 && metadata.durationSeconds > 0)) {
      throw new ExportSourceInvalidError("Source video has no usable size or duration");
    }
    const outputSize = toEvenSize(metadata.width, metadata.height);

    // Job-scoped working directory: the ASS file and a copy of just the fonts this style uses.
    const workDir = storage.getAbsolutePath(workKey);
    await mkdir(path.join(workDir, FONTS_DIRECTORY), { recursive: true });
    await writeFile(path.join(workDir, SUBTITLE_FILE), generateAss(request.segments, request.style, outputSize), "utf-8");
    for (const fileName of requiredFontFiles(request.style)) {
      try {
        await copyFile(path.join(deps.fontsSourceDirectory, fileName), path.join(workDir, FONTS_DIRECTORY, fileName));
      } catch {
        throw new ExportFontMissingError(fileName);
      }
    }

    if (isCancelRequested(jobId)) throw new ExportCancelledError();

    const renderPath = path.join(workDir, RENDER_FILE);
    let lastPercent = -1;
    await deps.processor.render(storage.getAbsolutePath(record.storageKey), {
      workingDirectory: workDir,
      subtitleFileName: SUBTITLE_FILE,
      fontsDirectoryName: FONTS_DIRECTORY,
      outputPath: renderPath,
      source: { durationSeconds: metadata.durationSeconds, hasAudio: metadata.hasAudio, audioCodec: metadata.audioCodec },
      outputSize,
      onProcessStart: (handle) => attachExportProcess(jobId, handle),
      onProgress: (percent) => {
        // 100% is reserved for "validated"; FFmpeg reaching the end is not that yet.
        const capped = Math.min(99, percent);
        if (capped !== lastPercent) {
          lastPercent = capped;
          persist({ progressPercent: capped });
        }
      },
    });

    if (isCancelRequested(jobId)) throw new ExportCancelledError();

    // Verify before believing FFmpeg's exit code.
    const output = await deps.processor.getMetadata(renderPath);
    const problems = validateExportOutput(output, {
      durationSeconds: metadata.durationSeconds,
      hasAudio: metadata.hasAudio,
      width: outputSize.width,
      height: outputSize.height,
    });
    if (problems.length > 0) throw new ExportOutputInvalidError(problems);

    await rename(renderPath, storage.getAbsolutePath(outputKey));
    const sizeBytes = (await stat(storage.getAbsolutePath(outputKey))).size;
    completed = true;
    persist({
      status: "completed",
      progressPercent: 100,
      finishedAt: new Date().toISOString(),
      error: null,
      output: { filename: exportDownloadFilename(record.originalFilename), sizeBytes, durationSeconds: output.durationSeconds },
      downloadUrl: `/api/export/${jobId}/download`,
    });
  } catch (error) {
    if (error instanceof ExportCancelledError || isCancelRequested(jobId)) {
      persist({ status: "cancelled", progressPercent: null, finishedAt: new Date().toISOString(), error: null });
    } else {
      console.error(`[export] job ${jobId} failed:`, error);
      persist({ status: "failed", progressPercent: null, finishedAt: new Date().toISOString(), error: toExportError(error) });
    }
  } finally {
    clearActiveExport(jobId);
    await storage.delete(workKey).catch((cleanupError) => {
      console.error(`[export] failed to clean up work files for job ${jobId}:`, cleanupError);
    });
    if (!completed) {
      await storage.delete(outputKey).catch(() => {});
    }
    await lastWrite;
  }
}
