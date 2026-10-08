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

const PUNCTUATION_ONLY = /^[^\p{L}\p{N}]+$/u;

/**
 * whisper.cpp reports BPE *tokens*, not words: "timestamps" arrives as
 * " tim" + "est" + "amps", and punctuation as its own token ("." with the
 * segment's end time). A token whose raw text starts with a space begins a
 * new word; one that doesn't continues the previous word (sub-word piece
 * or attached punctuation). Merging gives one `CaptionWord` per spoken
 * word. Attached punctuation never extends the word's end time — whisper
 * stamps it with the segment boundary, which would make the word appear
 * to be held through the following silence.
 */
function mergeTokensIntoWords(tokens: WhisperCppToken[]): TranscriptionWord[] {
  const words: TranscriptionWord[] = [];
  for (const token of tokens) {
    const raw = token.text ?? "";
    const tokenText = raw.trim();
    if (!tokenText || SPECIAL_TOKEN_PATTERN.test(tokenText)) continue;

    const start = msToSeconds(token.offsets?.from);
    const end = msToSeconds(token.offsets?.to);
    const previous = words[words.length - 1];
    const continuesPrevious = previous !== undefined && !/^\s/.test(raw);

    if (continuesPrevious) {
      previous.text += tokenText;
      if (!PUNCTUATION_ONLY.test(tokenText)) previous.end = Math.max(previous.end, end);
    } else {
      words.push({ text: tokenText, start, end });
    }
  }
  return sanitizeWordTiming(words);
}

/**
 * Real whisper.cpp output (captured 2026-10-08, a ~17-minute real talk,
 * reproduced identically across two separate transcription runs of the
 * same video) can report a token's `to` offset *earlier* than its `from`
 * offset, right after a pause: a run of consecutive tokens all anchored
 * to the same (correct) segment-start `from`, while each keeps a stale,
 * too-early `to` left over from an earlier decode attempt — e.g. "Notice"
 * at from=358.16/to=353.88, immediately following a ~5s silence. Nothing
 * downstream (`normalizeTranscription`, `segmentCaptions`) expects
 * `end < start`; left as-is it produced a `CaptionSegment` with a
 * negative duration, which the export validator (correctly) rejected.
 *
 * Never fabricate a plausible duration for these — collapse to a
 * zero-length word at its own (trustworthy) start and mark it
 * `approximate`, the same treatment already given to other
 * degenerate-timestamp whisper.cpp output elsewhere in this pipeline
 * (CLAUDE.md "preserve word-level timestamps... mark the result as
 * approximate rather than silently dropping it"). See ARCHITECTURE.md's
 * Export Validation notes for the full trace and the regression test
 * built from this exact captured pattern.
 */
function sanitizeWordTiming(words: TranscriptionWord[]): TranscriptionWord[] {
  return words.map((word) => (word.end < word.start ? { ...word, end: word.start, approximate: true } : word));
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

    const words = mergeTokensIntoWords(segment.tokens ?? []);

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
