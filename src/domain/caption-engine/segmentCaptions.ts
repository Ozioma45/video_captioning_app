import { generateId } from "@/lib/id";
import type { CaptionSegment, CaptionWord, SegmentationRules } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "./segmentationRules";
import { joinWordsAsText } from "./wordsText";

const SENTENCE_END_PATTERN = /[.!?…]["')\]]*$/;
const CLAUSE_END_PATTERN = /[,;:—–-]["')\]]*$/;
const PUNCTUATION_ONLY = /^[.,!?;:]+$/;

/** Words a caption should not end on — the phrase visibly continues on the next caption. */
const DANGLING_END_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "from", "by", "into", "onto", "about",
  "and", "or", "but", "so", "if", "as", "than", "that", "which", "who", "whose", "because", "while", "when",
  "is", "are", "was", "were", "be", "been", "am", "my", "your", "our", "their", "his", "her", "its",
  "i", "we", "you", "they", "he", "she", "it", "not", "no", "very", "really", "every", "each", "some", "any", "this", "these", "those",
]);
/** Words that naturally begin a new clause — a good place to start a caption. */
const CLAUSE_START_WORDS = new Set(["and", "but", "so", "because", "which", "when", "while", "if", "or", "then", "however"]);

/**
 * A silence longer than this always separates captions. Deliberately generous
 * (whisper's per-word times are only accurate to a few hundred ms and can
 * leave >1 s gaps before long words) so a timing quirk doesn't force an
 * ugly break like "and we run the" | "transcription".
 */
function maxIntraSegmentGapSeconds(rules: SegmentationRules): number {
  return Math.max(1.5, rules.pauseThresholdSeconds * 3);
}

function bareWord(word: CaptionWord): string {
  return word.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/**
 * Deterministic caption segmentation: `CaptionWord[] + SegmentationRules →
 * CaptionSegment[]` (ARCHITECTURE.md §7). Every input word lands in
 * exactly one output segment, in order, with its timing untouched.
 *
 * A segment's `startTime`/`endTime` come from its own first/last word (plus
 * a small bounded hold, below) — never from an enclosing provider segment.
 *
 * Hard limits (a segment never exceeds them, except a single word that is
 * itself over a limit): word count, character count, duration, and no
 * silence longer than `max(1.5s, 3 × pauseThreshold)` inside a segment.
 *
 * Within those limits, break points are chosen by dynamic programming
 * over the whole word sequence (O(n · maxWords)), minimizing a cost that
 * prefers: breaking after sentence-ending punctuation, breaking at a
 * pause, breaking after a comma, not ending on a dangling function word
 * ("the", "to", "and"…), starting a caption on a clause word ("and",
 * "but", "which"), fewer/longer segments over many tiny ones, and evenly
 * sized segments. Using a global optimum instead of a greedy fill avoids
 * the classic greedy failure of a full caption followed by a 1–2 word
 * orphan. No NLP — just these cheap, explainable heuristics.
 *
 * Hold: a caption's end is extended by up to `maxHoldSeconds` past its last
 * word so it doesn't vanish the instant the word ends, but never past the
 * next caption's start. The final caption is not held.
 */
export function segmentCaptions(words: CaptionWord[], rules: SegmentationRules = DEFAULT_SEGMENTATION_RULES): CaptionSegment[] {
  const n = words.length;
  if (n === 0) return [];

  const maxChars = rules.maxCharsPerLine * rules.maxLines;
  const maxIntraGap = maxIntraSegmentGapSeconds(rules);
  const targetChars = maxChars * 0.65;

  // Prefix sums so a candidate piece's character length is O(1).
  const charsPrefix = new Array<number>(n + 1).fill(0);
  const spacesPrefix = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k += 1) {
    charsPrefix[k + 1] = charsPrefix[k] + words[k].text.length;
    spacesPrefix[k + 1] = spacesPrefix[k] + (k > 0 && !PUNCTUATION_ONLY.test(words[k].text) ? 1 : 0);
  }
  const pieceChars = (i: number, j: number) => charsPrefix[j] - charsPrefix[i] + (spacesPrefix[j] - spacesPrefix[i + 1]);

  // Cost of ending a segment after word k (0 <= k < n-1): lower is a better place to break.
  const breakCost = new Array<number>(n).fill(0);
  for (let k = 0; k < n - 1; k += 1) {
    const word = words[k];
    const next = words[k + 1];
    const gap = next.startTime - word.endTime;
    let cost = 0;
    if (rules.breakOnPunctuation && SENTENCE_END_PATTERN.test(word.text)) cost -= 4;
    else if (rules.breakOnPunctuation && CLAUSE_END_PATTERN.test(word.text)) cost -= 1.5;
    // A pause is a good break; a longer one is better (−2 at the threshold, −4 from +0.5 s beyond it).
    if (gap >= rules.pauseThresholdSeconds) cost -= 2 + 2 * Math.min(1, (gap - rules.pauseThresholdSeconds) / 0.5);
    if (DANGLING_END_WORDS.has(bareWord(word)) && !SENTENCE_END_PATTERN.test(word.text)) cost += 3.5;
    if (CLAUSE_START_WORDS.has(bareWord(next))) cost -= 0.8;
    breakCost[k] = cost;
  }

  const best = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<number>(n + 1).fill(0);
  best[0] = 0;

  for (let j = 1; j <= n; j += 1) {
    for (let i = j - 1; i >= 0 && j - i <= rules.maxWordsPerSegment; i -= 1) {
      const count = j - i;
      if (count > 1) {
        // Adding word i to piece [i+1, j): stop growing left across a long silence, or past hard limits.
        if (words[i + 1].startTime - words[i].endTime > maxIntraGap) break;
        if (pieceChars(i, j) > maxChars) break;
        if (words[j - 1].endTime - words[i].startTime > rules.maxSegmentDurationSeconds) break;
      }
      if (best[i] === Infinity) continue;

      const chars = pieceChars(i, j);
      const duration = words[j - 1].endTime - words[i].startTime;
      let cost = 1 + 3 * ((chars - targetChars) / maxChars) ** 2;
      if (count === 1) cost += 4;
      else if (count === 2) cost += 2;
      if (duration < rules.minSegmentDurationSeconds) cost += 1;
      if (j < n) cost += breakCost[j - 1];

      const total = best[i] + cost;
      // Strict `<` plus scanning i downward keeps ties deterministic (prefers the shorter last piece).
      if (total < best[j]) {
        best[j] = total;
        from[j] = i;
      }
    }
  }

  const bounds: Array<[number, number]> = [];
  for (let j = n; j > 0; j = from[j]) bounds.push([from[j], j]);
  bounds.reverse();

  return bounds.map(([i, j], index) => {
    const piece = words.slice(i, j);
    const lastEnd = piece[piece.length - 1].endTime;
    // The final caption gets no hold: nothing bounds it, and it could run past the end of the video.
    const isLast = index + 1 >= bounds.length;
    const endTime = isLast
      ? lastEnd
      : Math.max(lastEnd, Math.min(lastEnd + rules.maxHoldSeconds, words[bounds[index + 1][0]].startTime));
    return {
      id: generateId(),
      startTime: piece[0].startTime,
      endTime,
      text: joinWordsAsText(piece),
      words: piece,
    };
  });
}
