import { describe, expect, it } from "vitest";

import type { CaptionSegment, CaptionWord } from "@/types";
import { findActiveSegment, findActiveWord, hasUsableWordTiming } from "../captionLookup";

const word = (id: string, startTime: number, endTime: number): CaptionWord => ({ id, text: id, startTime, endTime });
const segment = (id: string, startTime: number, endTime: number, words: CaptionWord[] = []): CaptionSegment => ({
  id,
  startTime,
  endTime,
  text: words.map((w) => w.text).join(" "),
  words,
});

const A = segment("a", 1, 3);
const B = segment("b", 3, 5); // adjacent to A
const C = segment("c", 8, 10);
const segments = [A, B, C];

describe("findActiveSegment", () => {
  it("returns null for an empty document", () => {
    expect(findActiveSegment([], 1)).toBeNull();
  });
  it("returns null before the first caption", () => {
    expect(findActiveSegment(segments, 0.5)).toBeNull();
  });
  it("is start-inclusive", () => {
    expect(findActiveSegment(segments, 1)).toBe(A);
  });
  it("returns the segment during it, including just before its end", () => {
    expect(findActiveSegment(segments, 1.5)).toBe(A);
    expect(findActiveSegment(segments, 2.999)).toBe(A);
  });
  it("is end-exclusive, handing off to an adjacent segment exactly at the boundary", () => {
    expect(findActiveSegment(segments, 3)).toBe(B);
    expect(findActiveSegment([A], 3)).toBeNull();
  });
  it("returns null in a gap between captions (no stale caption)", () => {
    expect(findActiveSegment(segments, 6)).toBeNull();
  });
  it("returns null after the final caption", () => {
    expect(findActiveSegment(segments, 10)).toBeNull();
    expect(findActiveSegment(segments, 999)).toBeNull();
  });
  it("derives from time alone, so seeking backward and forward is always correct", () => {
    expect(findActiveSegment(segments, 9)).toBe(C);
    expect(findActiveSegment(segments, 1.2)).toBe(A);
    expect(findActiveSegment(segments, 4)).toBe(B);
  });
  it("ignores non-finite times", () => {
    expect(findActiveSegment(segments, Number.NaN)).toBeNull();
    expect(findActiveSegment(segments, Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("with overlapping (malformed) segments, prefers the latest-starting active one and does not miss a long earlier one", () => {
    const long = segment("long", 0, 20);
    const short = segment("short", 2, 4);
    expect(findActiveSegment([long, short], 3)).toBe(short);
    expect(findActiveSegment([long, short], 10)).toBe(long);
  });
  it("stays correct on a large sorted document", () => {
    const many = Array.from({ length: 5000 }, (_, i) => segment(`s${i}`, i * 2, i * 2 + 1.5));
    expect(findActiveSegment(many, 4000.2)?.id).toBe("s2000");
    expect(findActiveSegment(many, 4001.7)).toBeNull();
  });
});

describe("findActiveWord", () => {
  const words = [word("w1", 1, 1.5), word("w2", 1.5, 2), word("w3", 2.4, 3)];
  const seg = segment("s", 1, 3, words);

  it("returns null before the first word", () => {
    expect(findActiveWord(seg, 0.9)).toBeNull();
  });
  it("is start-inclusive and end-exclusive", () => {
    expect(findActiveWord(seg, 1)?.id).toBe("w1");
    expect(findActiveWord(seg, 1.499)?.id).toBe("w1");
    expect(findActiveWord(seg, 1.5)?.id).toBe("w2");
  });
  it("returns the word during it", () => {
    expect(findActiveWord(seg, 2.7)?.id).toBe("w3");
  });
  it("returns null between words", () => {
    expect(findActiveWord(seg, 2.2)).toBeNull();
  });
  it("returns null after the final word", () => {
    expect(findActiveWord(seg, 3)).toBeNull();
    expect(findActiveWord(seg, 50)).toBeNull();
  });
  it("returns null when words are missing or undefined", () => {
    expect(findActiveWord(segment("s", 1, 3, []), 2)).toBeNull();
    expect(findActiveWord({ ...seg, words: undefined as unknown as CaptionWord[] }, 2)).toBeNull();
  });
  it("returns null when the words are stale after a text edit", () => {
    expect(findActiveWord({ ...seg, wordsStale: true }, 1.2)).toBeNull();
  });
  it("returns null for malformed word timing rather than guessing", () => {
    expect(findActiveWord(segment("s", 1, 3, [word("x", 2, 1)]), 1.5)).toBeNull();
    expect(findActiveWord(segment("s", 1, 3, [word("x", Number.NaN, 2)]), 1.5)).toBeNull();
    expect(findActiveWord(segment("s", 1, 3, [word("x", 2, 3), word("y", 1, 1.5)]), 1.2)).toBeNull();
  });
});

describe("hasUsableWordTiming", () => {
  it("accepts ordered real timing and rejects empty/stale lists", () => {
    expect(hasUsableWordTiming(segment("s", 0, 1, [word("a", 0, 0.5)]))).toBe(true);
    expect(hasUsableWordTiming(segment("s", 0, 1, []))).toBe(false);
    expect(hasUsableWordTiming({ ...segment("s", 0, 1, [word("a", 0, 0.5)]), wordsStale: true })).toBe(false);
  });
});
