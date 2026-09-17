import { CANDIDATE_VIDEO_FORMATS, MAX_VIDEO_FILE_SIZE_BYTES } from "@/config/limits";
import { formatFileSize } from "@/lib/format";

/**
 * Fast client-side validation only — UX feedback, not a security boundary
 * (PROJECT.md §6, Phase 2 brief). The server independently re-validates
 * everything via ffprobe (see app/api/upload/route.ts). Accepts a
 * structurally-typed subset of `File` so it's testable without the DOM.
 */
export interface VideoFileLike {
  name: string;
  size: number;
  type: string;
}

export type VideoFileValidationResult = { valid: true } | { valid: false; reason: string };

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot + 1).toLowerCase();
}

export function validateVideoFileClientSide(file: VideoFileLike): VideoFileValidationResult {
  if (file.size <= 0) {
    return { valid: false, reason: "This file is empty." };
  }

  if (file.size > MAX_VIDEO_FILE_SIZE_BYTES) {
    return {
      valid: false,
      reason: `This file is larger than the ${formatFileSize(MAX_VIDEO_FILE_SIZE_BYTES)} limit.`,
    };
  }

  const extension = getFileExtension(file.name);
  const looksLikeVideo =
    file.type.startsWith("video/") || (CANDIDATE_VIDEO_FORMATS as readonly string[]).includes(extension);

  if (!looksLikeVideo) {
    return { valid: false, reason: "This doesn't look like a supported video file." };
  }

  return { valid: true };
}
