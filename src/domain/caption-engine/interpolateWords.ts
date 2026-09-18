import { generateId } from "@/lib/id";
import type { CaptionWord } from "@/types";

/**
 * Evenly interpolates word timing across a known text/time span when no
 * real per-word timing exists — shared by `normalizeTranscription.ts`
 * (a provider that returns only segment-level timing) and
 * `captionMutations.ts` (a segment whose `words` is empty, e.g. after
 * upstream data loss). Every resulting word is marked `approximate: true`
 * — CLAUDE.md "if a transformation can't preserve exact word timing, it
 * must mark the result as approximate rather than silently dropping it."
 */
export function interpolateWordsFromText(text: string, startTime: number, endTime: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const span = Math.max(endTime - startTime, 0);
  const perWord = span / tokens.length;

  return tokens.map((tokenText, index) => ({
    id: generateId(),
    text: tokenText,
    startTime: startTime + perWord * index,
    endTime: startTime + perWord * (index + 1),
    approximate: true,
  }));
}
