import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

import type { VideoMetadata } from "@/types";
import type { ExtractAudioOptions, RenderOptions, VideoProcessor } from "./VideoProcessingService";
import { buildRenderArgs } from "./buildRenderArgs";
import { parseFfprobeOutput, type FfprobeOutput } from "./parseFfprobeOutput";
import { computeProgressPercent, extractLatestOutTimeSeconds } from "./parseFfmpegProgress";
import { classifyFfmpegExecError, classifyFfmpegRenderError, classifyFfprobeExecError, UnreadableVideoError } from "./errors";

const execFileAsync = promisify(execFile);

const FFPROBE_TIMEOUT_MS = 30_000;
// ffprobe reads container/stream headers, not full frames — its JSON
// output stays small even for a multi-hour file, but we cap generously.
const FFPROBE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

// Audio extraction only demuxes/resamples the audio stream (no video
// decoding, per ARCHITECTURE.md §5) — even a 2-hour source finishes in
// well under a minute in practice. This ceiling is generous headroom
// against a hang, not an expected duration.
const FFMPEG_EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * `VideoProcessor` implementation backed by ffprobe/FFmpeg
 * (ARCHITECTURE.md §5, §10; PROJECT.md §23-24): `getMetadata` (Phase 2),
 * `extractAudio` (Phase 3) and `render` (Phase 7).
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

  /**
   * Extracts a 16kHz mono PCM WAV — whisper.cpp's required input format
   * (verified directly against the installed ffmpeg build: `-ar 16000 -ac
   * 1 -f wav`). `-vn` skips video decoding entirely, so this stays fast
   * and cheap regardless of source resolution/length (ARCHITECTURE.md
   * §5, §12 — never re-encode video for a step that doesn't need it).
   *
   * Uses `spawn` directly (not the promisified `execFile` used
   * elsewhere) so we can stream `-progress pipe:1` output as it arrives
   * for real, honest progress (PROJECT.md §38) — never a fabricated
   * percentage — while still cleanly killing the process on timeout.
   */
  async extractAudio(videoFilePath: string, outputAudioPath: string, options: ExtractAudioOptions): Promise<void> {
    // ffmpeg won't create missing parent directories itself — a real
    // 2026-09-18 E2E run against a fresh job's never-before-used temp
    // directory failed with "No such file or directory" until this was
    // added. Mirrors LocalFilesystemStorage.save's same mkdir call.
    await mkdir(path.dirname(outputAudioPath), { recursive: true });

    const args = [
      "-y",
      "-i",
      videoFilePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "-progress",
      "pipe:1",
      "-nostats",
      outputAudioPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegInstaller.path, args);
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
        settle(new Error("ffmpeg audio extraction timed out"));
      }, FFMPEG_EXTRACT_TIMEOUT_MS);

      function settle(error: Error | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf-8");
        const elapsed = extractLatestOutTimeSeconds(stdoutBuffer);
        if (elapsed !== null) {
          options.onProgress?.(computeProgressPercent(elapsed, options.durationSeconds));
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString("utf-8");
        if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
      });

      child.on("error", (error) => settle(error));

      child.on("close", (code) => {
        if (code === 0) {
          settle(null);
          return;
        }
        const error = Object.assign(new Error(`ffmpeg exited with code ${code}`), {
          code: code ?? undefined,
          stderr: stderrBuffer,
        });
        settle(error);
      });
    }).catch((error: unknown) => {
      const classified = classifyFfmpegExecError(error);
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      console.error(
        `[ffmpeg] ${classified.name} while extracting audio from ${videoFilePath}:`,
        `code=${nodeError.code ?? "unknown"}`,
        nodeError.stderr ? `stderr=${nodeError.stderr.slice(0, 500)}` : `message=${nodeError.message}`,
      );
      throw classified;
    });
  }

  /**
   * Burns ASS captions into the video. `spawn` with an argument array (see
   * `buildRenderArgs`), run inside `options.workingDirectory` so the
   * subtitle file and fonts directory are referenced by relative name.
   * Streams `-progress pipe:1` for real progress against the source
   * duration; the video is processed by FFmpeg as a file/stream, never read
   * into Node. `onProcessStart` hands the caller a handle that kills the
   * process (cancellation).
   */
  async render(videoFilePath: string, options: RenderOptions): Promise<void> {
    const args = buildRenderArgs(videoFilePath, options);
    await mkdir(path.dirname(options.outputPath), { recursive: true });

    // Generous ceiling against a hang, scaled to the source (re-encoding is
    // slower than real time on weak machines), not an expected duration.
    const timeoutMs = Math.min(6 * 3600_000, 15 * 60_000 + options.source.durationSeconds * 8_000);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegInstaller.path, args, { cwd: options.workingDirectory, windowsHide: true });
      let progressBuffer = "";
      let stderrTail = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
        settle(new Error("ffmpeg render timed out"));
      }, timeoutMs);

      function settle(error: Error | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }

      options.onProcessStart?.({ cancel: () => child.kill("SIGKILL") });

      child.stdout.on("data", (chunk: Buffer) => {
        // Only the latest few KB matter for "the most recent out_time".
        progressBuffer = (progressBuffer + chunk.toString("utf-8")).slice(-4096);
        const elapsed = extractLatestOutTimeSeconds(progressBuffer);
        if (elapsed !== null) options.onProgress?.(computeProgressPercent(elapsed, options.source.durationSeconds));
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf-8")).slice(-4000);
      });

      child.on("error", (error) => settle(error));

      child.on("close", (code, signal) => {
        if (code === 0) {
          settle(null);
          return;
        }
        settle(
          Object.assign(new Error(`ffmpeg exited with code ${code ?? signal}`), {
            code: code ?? undefined,
            stderr: stderrTail,
          }),
        );
      });
    }).catch((error: unknown) => {
      const classified = classifyFfmpegRenderError(error);
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      // Diagnostics stay server-side (with the input path, which is ours); never sent to the client.
      console.error(
        `[ffmpeg] ${classified.name} while rendering captions for ${videoFilePath}:`,
        `code=${nodeError.code ?? "unknown"}`,
        nodeError.stderr ? `stderr=${nodeError.stderr.slice(-1500)}` : `message=${nodeError.message}`,
      );
      throw classified;
    });
  }
}

export const videoProcessor: VideoProcessor = new FfmpegVideoProcessor();
