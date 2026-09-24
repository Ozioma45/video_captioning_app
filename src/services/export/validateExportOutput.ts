import type { VideoMetadata } from "@/types";

export interface ExportExpectation {
  durationSeconds: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

/**
 * Post-render checks (ffprobe of the produced file against what the source
 * promised). FFmpeg exiting 0 is not enough to call an export complete —
 * a completed job means every one of these held. Returns the list of
 * problems, empty when the file is good.
 */
export function validateExportOutput(output: VideoMetadata, expected: ExportExpectation): string[] {
  const problems: string[] = [];

  if (output.fileSizeBytes <= 0) problems.push("output file is empty");
  if (output.videoCodec !== "h264") problems.push(`unexpected video codec ${output.videoCodec ?? "none"}`);
  if (!(output.containerFormat ?? "").includes("mp4")) problems.push("output is not an MP4 container");
  if (expected.hasAudio && !output.hasAudio) problems.push("audio track is missing");
  if (!expected.hasAudio && output.hasAudio) problems.push("unexpected audio track");
  if (output.width !== expected.width || output.height !== expected.height) {
    problems.push(`unexpected frame size ${output.width}x${output.height}`);
  }

  const tolerance = Math.max(1, expected.durationSeconds * 0.02);
  if (!(Math.abs(output.durationSeconds - expected.durationSeconds) <= tolerance)) {
    problems.push(`duration ${output.durationSeconds.toFixed(2)}s differs from source ${expected.durationSeconds.toFixed(2)}s`);
  }

  return problems;
}

/** H.264/yuv420p needs even dimensions; the render scales odd sources down by at most one pixel. */
export function toEvenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}
