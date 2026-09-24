/**
 * Video processing abstraction — FFmpeg is the intended V1 implementation
 * (PROJECT.md §23-24, ARCHITECTURE.md §5, §10), invoked only via argument
 * arrays (`execFile`/`spawn`), never a shell string (CLAUDE.md "never
 * construct unsafe shell commands").
 *
 * `getMetadata` (Phase 2), `extractAudio` (Phase 3) and `render` (Phase 7,
 * ASS/libass burn-in) are real.
 */

import type { CancellableProcessHandle, VideoMetadata } from "@/types";

export interface RenderOptions {
  /**
   * Directory FFmpeg runs in. The filter graph refers to the subtitle file
   * and fonts directory by *relative name* inside it, so no path (with its
   * drive-letter colons and backslashes) is ever embedded in filter syntax.
   */
  workingDirectory: string;
  /** Name of the .ass file inside `workingDirectory` (a constant, never user text). */
  subtitleFileName: string;
  /** Name of the directory of .ttf fonts inside `workingDirectory`. */
  fontsDirectoryName: string;
  /** Absolute path of the file to write (server-generated). */
  outputPath: string;
  /** Source facts the render plan depends on. */
  source: { durationSeconds: number; hasAudio: boolean; audioCodec: string | null };
  /** Output frame size (even numbers, as H.264/yuv420p requires) — the size the subtitles were laid out for. */
  outputSize: { width: number; height: number };
  /** Called with a real 0-100 value parsed from FFmpeg `-progress` output. */
  onProgress?: (percent: number) => void;
  /** Receives a handle that terminates the FFmpeg process (job cancellation). */
  onProcessStart?: (handle: CancellableProcessHandle) => void;
}

export interface ExtractAudioOptions {
  /** Known source video duration, used to turn ffmpeg's `-progress` output into a real percent. */
  durationSeconds: number;
  onProgress?: (percent: number) => void;
}

export interface VideoProcessor {
  getMetadata(videoFilePath: string): Promise<VideoMetadata>;
  /** Extracts a 16kHz mono WAV suitable for the transcription provider. */
  extractAudio(videoFilePath: string, outputAudioPath: string, options: ExtractAudioOptions): Promise<void>;
  /** Burns the ASS subtitles into the video (re-encodes video, preserves audio). Resolves when FFmpeg exits 0; output validation is the caller's job. */
  render(videoFilePath: string, options: RenderOptions): Promise<void>;
}
