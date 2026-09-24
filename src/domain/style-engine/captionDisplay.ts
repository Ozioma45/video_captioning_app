import { hasUsableWordTiming } from "@/domain/caption-engine/captionLookup";
import type { CaptionSegment, CaptionStyle } from "@/types";

const PUNCTUATION_ONLY = /^[.,!?;:]+$/;

export interface DisplayWord {
  id: string;
  text: string;
  /** False for punctuation-only tokens, which attach to the previous word. */
  spaceBefore: boolean;
}

/**
 * What the preview should draw for one segment under one style — decided
 * from data (`highlightMode` + whether real word timing exists), never
 * from a preset id, so a sixth preset needs no new branch (CLAUDE.md
 * "Keep caption styles modular").
 *
 * - `plain`: the segment's current text as one string. Used when the style
 *   doesn't highlight, or when word timing is missing/stale/invalid — in
 *   which case highlighting is disabled rather than fabricated.
 * - `words`: individually addressable words. `trackActiveWord` says the
 *   renderer should highlight whichever word contains the playback time;
 *   `emphasisWordId` is a statically emphasized word (no timing needed).
 */
export type CaptionDisplay =
  | { kind: "plain"; text: string }
  | { kind: "words"; words: DisplayWord[]; trackActiveWord: boolean; emphasisWordId: string | null };

export function resolveCaptionDisplay(segment: CaptionSegment, style: CaptionStyle): CaptionDisplay {
  if (style.highlightMode === "none" || !hasUsableWordTiming(segment)) {
    return { kind: "plain", text: segment.text };
  }

  const words: DisplayWord[] = segment.words.map((word, index) => ({
    id: word.id,
    text: word.text,
    spaceBefore: index > 0 && !PUNCTUATION_ONLY.test(word.text),
  }));

  return {
    kind: "words",
    words,
    trackActiveWord: style.highlightMode === "activeWord",
    // TODO(future): there is no keyword/emphasis data yet; "emphasis" marks the
    // segment's final word, matching the style-picker preview.
    emphasisWordId: style.highlightMode === "emphasis" ? (words[words.length - 1]?.id ?? null) : null,
  };
}
