import { NextResponse, type NextRequest } from "next/server";

import { MAX_VIDEO_DURATION_SECONDS, MAX_VIDEO_FILE_SIZE_BYTES } from "@/config/limits";
import { generateId } from "@/lib/id";
import { sanitizeDisplayFilename } from "@/lib/sanitize";
import { createByteLimitTransformStream, PayloadTooLargeError } from "@/lib/limitStream";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import { videoProcessor } from "@/services/video-processing/FfmpegVideoProcessor";
import { resolveContentType } from "@/services/video-processing/formatToContentType";
import { FfprobeUnavailableError, UnreadableVideoError } from "@/services/video-processing/errors";
import {
  saveVideoRecord,
  videoDirectoryKey,
  videoSourceKey,
  type StoredVideoRecord,
} from "@/services/videos/videoRecordStore";
import type { VideoMetadata } from "@/types";

// Streams the request body straight to disk and shells out to ffprobe —
// needs Node APIs, so this route cannot run on the edge runtime.
export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const contentLengthHeader = request.headers.get("content-length");
  const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (declaredSize !== null && Number.isFinite(declaredSize) && declaredSize > MAX_VIDEO_FILE_SIZE_BYTES) {
    return errorResponse(413, "file_too_large", "This file is larger than the supported maximum.");
  }

  if (!request.body) {
    return errorResponse(400, "empty_body", "No file was received.");
  }

  const videoId = generateId();
  const storageKey = videoSourceKey(videoId);
  const originalFilename = sanitizeDisplayFilename(request.headers.get("x-filename") ?? "video");
  const declaredContentType = request.headers.get("content-type") || "application/octet-stream";

  try {
    const limited = request.body.pipeThrough(createByteLimitTransformStream(MAX_VIDEO_FILE_SIZE_BYTES));
    await storageProvider.save(storageKey, limited as unknown as ReadableStream);
  } catch (error) {
    await storageProvider.delete(videoDirectoryKey(videoId)).catch(() => {});
    if (error instanceof PayloadTooLargeError) {
      return errorResponse(413, "file_too_large", "This file is larger than the supported maximum.");
    }
    console.error("[upload] failed while streaming to disk", error);
    return errorResponse(500, "upload_failed", "The upload failed partway through. Please try again.");
  }

  const absolutePath = storageProvider.getAbsolutePath(storageKey);

  let probed: VideoMetadata;
  try {
    probed = await videoProcessor.getMetadata(absolutePath);
  } catch (error) {
    await storageProvider.delete(videoDirectoryKey(videoId)).catch(() => {});
    if (error instanceof FfprobeUnavailableError) {
      console.error("[upload] ffprobe unavailable", error);
      return errorResponse(
        503,
        "processor_unavailable",
        "Video processing is temporarily unavailable. Please try again shortly.",
      );
    }
    if (error instanceof UnreadableVideoError) {
      return errorResponse(422, "invalid_video", "This file doesn't appear to be a valid, readable video.");
    }
    console.error("[upload] unexpected metadata extraction failure", error);
    return errorResponse(500, "metadata_failed", "Could not read this video's metadata. Please try again.");
  }

  if (probed.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    await storageProvider.delete(videoDirectoryKey(videoId)).catch(() => {});
    const maxHours = Math.round(MAX_VIDEO_DURATION_SECONDS / 3600);
    return errorResponse(
      422,
      "duration_exceeded",
      `This video is longer than the ${maxHours}-hour limit supported in this version.`,
    );
  }

  const metadata: VideoMetadata = { ...probed, filename: originalFilename };
  const contentType = resolveContentType(metadata.containerFormat, declaredContentType);

  const record: StoredVideoRecord = {
    videoId,
    storageKey,
    contentType,
    originalFilename,
    metadata,
    createdAt: new Date().toISOString(),
  };

  try {
    await saveVideoRecord(record);
  } catch (error) {
    await storageProvider.delete(videoDirectoryKey(videoId)).catch(() => {});
    console.error("[upload] failed to persist video record", error);
    return errorResponse(500, "storage_failed", "Could not save the uploaded video. Please try again.");
  }

  return NextResponse.json({ videoId, metadata });
}
