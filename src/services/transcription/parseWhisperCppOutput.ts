import type { TranscriptionResult, TranscriptionSegment, TranscriptionWord } from "@/types";
import { MalformedTranscriptionResultError } from "./errors";

/**
 * Minimal shape of whisper.cpp's `--output-json-full` (`-ojf`) output —
 * the documented mechanism for token/word-level timestamps (as opposed to
 * plain `-oj`, which only gives segment-level text+timing). Token text
 * can be sub-word BPE pieces rather than whole words for some languages;
 * we treat each token as our `CaptionWord` granularity, which is accurate
 * for English in the common case but not a guarantee — see
 * ARCHITECTURE.md's Phase 3 notes for why this is disclosed rather than
 * silently assumed perfect.
 */
export interface WhisperCppToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

export interface WhisperCppSegment {
  text?: string;
  offsets?: { from?: number; to?: number };
  tokens?: WhisperCppToken[];
}

export interface WhisperCppOutput {
  result?: { language?: string };
  transcription?: WhisperCppSegment[];
}

// whisper.cpp emits control/special tokens interleaved with real words —
// these aren't spoken words and must never end up in a CaptionWord.
// Two conventions have been observed in real output (not just assumed):
// the older bracket style ("[_BEG_]", "[_TT_123]") and the newer
// angle-pipe style used by the current tokenizer ("<|endoftext|>",
// "<|en|>", "<|transcribe|>") — the latter was caught by a real Phase 4
// end-to-end run (2026-09-18) leaking a literal "<|endoftext|>" token
// into a CaptionWord at the tail of a long, single-segment transcript.
const SPECIAL_TOKEN_PATTERN = /^(\[_[A-Z_0-9]+\]|<\|[a-zA-Z0-9._]+\|>)$/;

function msToSeconds(ms: number | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) ? ms / 1000 : 0;
}

export function parseWhisperCppOutput(raw: WhisperCppOutput): TranscriptionResult {
  if (!raw || !Array.isArray(raw.transcription)) {
    throw new MalformedTranscriptionResultError("whisper.cpp output is missing a transcription array");
  }

  if (raw.transcription.length === 0) {
    throw new MalformedTranscriptionResultError("whisper.cpp produced no transcription segments");
  }

  const segments: TranscriptionSegment[] = raw.transcription.map((segment, index) => {
    const start = msToSeconds(segment.offsets?.from);
    const end = msToSeconds(segment.offsets?.to);
    const text = (segment.text ?? "").trim();

    const words: TranscriptionWord[] = (segment.tokens ?? [])
      .map((token): TranscriptionWord | null => {
        const tokenText = (token.text ?? "").trim();
        if (!tokenText || SPECIAL_TOKEN_PATTERN.test(tokenText)) return null;
        return {
          text: tokenText,
          start: msToSeconds(token.offsets?.from),
          end: msToSeconds(token.offsets?.to),
        };
      })
      .filter((word): word is TranscriptionWord => word !== null);

    if (!text && words.length === 0) {
      throw new MalformedTranscriptionResultError(`whisper.cpp segment ${index} has no text and no tokens`);
    }

    return { start, end, text, words };
  });

  return {
    language: raw.result?.language || "unknown",
    segments,
  };
}
