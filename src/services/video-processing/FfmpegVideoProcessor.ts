import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import path from "node:path";

import ffprobeInstaller from "@ffprobe-installer/ffprobe";

import type { VideoMetadata } from "@/types";
import type { VideoProcessor } from "./VideoProcessingService";
import { parseFfprobeOutput, type FfprobeOutput } from "./parseFfprobeOutput";
import { classifyFfprobeExecError, UnreadableVideoError } from "./errors";

const execFileAsync = promisify(execFile);

const FFPROBE_TIMEOUT_MS = 30_000;
// ffprobe reads container/stream headers, not full frames — its JSON
// output stays small even for a multi-hour file, but we cap generously.
const FFPROBE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * `VideoProcessor` implementation backed by ffprobe/FFmpeg
 * (ARCHITECTURE.md §5, §10; PROJECT.md §23-24). Only `getMetadata` is real
 * in Phase 2 — `extractAudio` (Phase 3) and `render` (Phase 7) throw
 * rather than pretending to work (CLAUDE.md "do not fake functionality").
 *
 * ffprobe is always invoked via `execFile` with an argument array, never
 * a shell string — the path being probed is always a server-generated
 * storage path, never user-controlled text, but the rule is applied
 * unconditionally as defense in depth (CLAUDE.md "never construct unsafe
 * shell commands").
 */
export class FfmpegVideoProcessor implements VideoProcessor {
  async getMetadata(videoFilePath: string): Promise<VideoMetadata> {
    const raw = await this.runFfprobe(videoFilePath);
    const probed = parseFfprobeOutput(raw);
    const stats = await stat(videoFilePath);

    return {
      filename: path.basename(videoFilePath),
      fileSizeBytes: stats.size,
      ...probed,
    };
  }

  private async runFfprobe(videoFilePath: string): Promise<FfprobeOutput> {
    const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", videoFilePath];

    let stdout: string;
    try {
      const result = await execFileAsync(ffprobeInstaller.path, args, {
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: FFPROBE_MAX_BUFFER_BYTES,
      });
      stdout = result.stdout;
    } catch (error) {
      const classified = classifyFfprobeExecError(error);
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      // Always logged, regardless of which way this classifies — silence
      // here is what let a tooling failure masquerade as "invalid video"
      // undetected. See classifyFfprobeExecError's doc comment.
      console.error(
        `[ffprobe] ${classified.name} while probing ${videoFilePath}:`,
        `code=${nodeError.code ?? "unknown"}`,
        nodeError.stderr ? `stderr=${nodeError.stderr.slice(0, 500)}` : `message=${nodeError.message}`,
      );
      throw classified;
    }

    try {
      return JSON.parse(stdout) as FfprobeOutput;
    } catch (error) {
      console.error(`[ffprobe] returned unparsable output while probing ${videoFilePath}:`, stdout.slice(0, 500));
      throw new UnreadableVideoError("ffprobe returned unparsable output", error);
    }
  }

  async extractAudio(): Promise<void> {
    throw new Error("extractAudio is not implemented until Phase 3 (transcription)");
  }

  async render(): Promise<void> {
    throw new Error("render is not implemented until Phase 7 (export)");
  }
}

export const videoProcessor: VideoProcessor = new FfmpegVideoProcessor();
