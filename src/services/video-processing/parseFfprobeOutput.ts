import { UnreadableVideoError } from "./errors";

/** Minimal shape of `ffprobe -print_format json -show_format -show_streams` output that we read. */
export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  /** Older ffprobe builds report display rotation as a stream tag... */
  tags?: { rotate?: string };
  /** ...newer ones as display-matrix side data. */
  side_data_list?: Array<{ rotation?: number | string }>;
}

/** Display rotation in degrees, normalized to 0/90/180/270 (0 when absent or unparsable). */
function displayRotation(stream: FfprobeStream): number {
  const raw = stream.tags?.rotate ?? stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation;
  const degrees = Number(raw);
  if (!Number.isFinite(degrees)) return 0;
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

export interface FfprobeFormat {
  format_name?: string;
  duration?: string;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export type ProbedVideoInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number | null;
  videoCodec: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  containerFormat: string | null;
};

function parseFrameRate(rFrameRate: string | undefined): number | null {
  if (!rFrameRate) return null;
  const [numerator, denominator] = rFrameRate.split("/").map(Number);
  if (!numerator || !denominator) return null;
  return numerator / denominator;
}

/**
 * Pure mapping from raw ffprobe JSON to our domain metadata shape
 * (ARCHITECTURE.md §6 — provider output is normalized before the rest of
 * the app ever sees it). Throws `UnreadableVideoError` when the file has
 * no video stream at all, since Caption Studio captions videos, not bare
 * audio files — a deliberate, narrow rejection, not an arbitrary one.
 */
export function parseFfprobeOutput(raw: FfprobeOutput): ProbedVideoInfo {
  const streams = raw.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");

  if (!videoStream) {
    throw new UnreadableVideoError("No video stream found in file");
  }

  const durationSeconds = Number(raw.format?.duration ?? 0);

  // Width/height are the DISPLAY size: a phone video coded 1920x1080 with a
  // 90/270 degree rotation plays (and is exported by FFmpeg) as 1080x1920.
  const swapped = displayRotation(videoStream) % 180 === 90;
  const codedWidth = videoStream.width ?? 0;
  const codedHeight = videoStream.height ?? 0;

  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    width: swapped ? codedHeight : codedWidth,
    height: swapped ? codedWidth : codedHeight,
    frameRate: parseFrameRate(videoStream.r_frame_rate),
    videoCodec: videoStream.codec_name ?? null,
    hasAudio: audioStream !== undefined,
    audioCodec: audioStream?.codec_name ?? null,
    containerFormat: raw.format?.format_name ?? null,
  };
}
