import type { RenderOptions } from "./VideoProcessingService";

/**
 * The FFmpeg argument array for the caption burn-in — pure, so the safety
 * properties are unit-testable. Everything variable is either a
 * server-generated path passed as its own argv element, or a number
 * validated upstream. The `-vf` value is built only from constants and
 * integers: the subtitle/fonts names are fixed strings the server chose
 * (relative to the process's working directory), and caption text lives
 * inside the .ass file, never on the command line.
 *
 * - Video is re-encoded (H.264, yuv420p, CRF 20) — burning in requires it.
 * - Audio is stream-copied when it is already AAC, otherwise encoded to
 *   AAC; `0:a:0?` makes audio optional so silent sources still work.
 * - `-movflags +faststart` moves the index to the front so the file plays
 *   while downloading.
 */
export function buildRenderArgs(videoFilePath: string, options: RenderOptions): string[] {
  const { width, height } = options.outputSize;
  for (const value of [width, height]) {
    if (!Number.isInteger(value) || value <= 0) throw new Error("Invalid output size");
  }
  for (const name of [options.subtitleFileName, options.fontsDirectoryName]) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Unsafe filter file name");
  }

  // Even dimensions are required for yuv420p. The scale is a no-op for even sources.
  const filter = `scale=${width}:${height},ass=${options.subtitleFileName}:fontsdir=${options.fontsDirectoryName}`;
  const copyAudio = options.source.hasAudio && options.source.audioCodec === "aac";

  return [
    "-y",
    "-hide_banner",
    "-nostdin",
    "-i",
    videoFilePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    options.outputPath,
  ];
}
