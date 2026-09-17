import { UnreadableVideoError } from "./errors";

/** Minimal shape of `ffprobe -print_format json -show_format -show_streams` output that we read. */
export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
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

  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    frameRate: parseFrameRate(videoStream.r_frame_rate),
    videoCodec: videoStream.codec_name ?? null,
    hasAudio: audioStream !== undefined,
    audioCodec: audioStream?.codec_name ?? null,
    containerFormat: raw.format?.format_name ?? null,
  };
}
