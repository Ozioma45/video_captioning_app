/**
 * Provider-facing transcription types.
 *
 * These describe the shape a `TranscriptionProvider` implementation speaks
 * in (see services/transcription/TranscriptionService.ts). They are
 * deliberately kept separate from the domain caption model
 * (types/caption.ts) — see ARCHITECTURE.md §6 / PROJECT.md §9-10. A raw
 * `TranscriptionResult` is normalized into a `CaptionDocument` by an
 * adapter; the rest of the application never imports this file directly.
 */

export interface TranscriptionInput {
  /** Path to a local audio file (extracted from the source video). */
  audioFilePath: string;
  /** BCP-47 language hint, if known. Omit to let the provider auto-detect. */
  language?: string;
}

export interface TranscriptionWord {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /**
   * True when the provider did not return real per-word timing and this
   * value was interpolated by the adapter. Must never be silently dropped —
   * see CLAUDE.md "Preserve word-level timestamps".
   */
  approximate?: boolean;
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  words: TranscriptionWord[];
}

export interface TranscriptionResult {
  language: string;
  segments: TranscriptionSegment[];
}

export type TranscriptionProviderId = "local-whisper-cpp" | "openai-whisper" | "deepgram" | "assemblyai";
