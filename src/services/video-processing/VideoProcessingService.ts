/**
 * Video processing abstraction — FFmpeg is the intended V1 implementation
 * (PROJECT.md §23-24, ARCHITECTURE.md §5, §10), invoked only via argument
 * arrays (`execFile`/`spawn`), never a shell string (CLAUDE.md "never
 * construct unsafe shell commands").
 *
 * Interface only — no implementation in Phase 1. `getMetadata` +
 * `extractAudio` are built in Phases 2-3; `render` (the ASS/libass burn-in
 * export path) is built in Phase 7.
 */

import type { VideoMetadata } from "@/types";

export interface RenderOptions {
  /** Path to the .ass subtitle file to burn in (see ARCHITECTURE.md §10). */
  subtitleFilePath: string;
  outputPath: string;
  /** Called with a real 0-100 value parsed from FFmpeg `-progress` output. */
  onProgress?: (percent: number) => void;
}

export interface VideoProcessor {
  getMetadata(videoFilePath: string): Promise<VideoMetadata>;
  /** Extracts a 16kHz mono WAV suitable for the transcription provider. */
  extractAudio(videoFilePath: string, outputAudioPath: string): Promise<void>;
  render(videoFilePath: string, options: RenderOptions): Promise<void>;
}
