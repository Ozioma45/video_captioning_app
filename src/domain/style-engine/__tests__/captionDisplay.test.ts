import { describe, expect, it } from "vitest";

import type { CaptionSegment } from "@/types";
import { resolveCaptionDisplay } from "../captionDisplay";
import { getStylePreset, listStylePresets } from "../styleRegistry";

const segment: CaptionSegment = {
  id: "s1",
  startTime: 0,
  endTime: 3,
  text: "Hello , world today",
  words: [
    { id: "w1", text: "Hello", startTime: 0, endTime: 1 },
    { id: "w2", text: ",", startTime: 1, endTime: 1.1 },
    { id: "w3", text: "world", startTime: 1.1, endTime: 2 },
    { id: "w4", text: "today", startTime: 2, endTime: 3 },
  ],
};

const style = (id: string) => getStylePreset(id)!;

describe("resolveCaptionDisplay", () => {
  it("Classic renders plain text (no highlight)", () => {
    expect(resolveCaptionDisplay(segment, style("classic"))).toEqual({ kind: "plain", text: segment.text });
  });

  it("Podcast renders plain text", () => {
    expect(resolveCaptionDisplay(segment, style("podcast")).kind).toBe("plain");
  });

  it("Karaoke and Dynamic track the active word with real words", () => {
    for (const id of ["karaoke", "dynamic"]) {
      const display = resolveCaptionDisplay(segment, style(id));
      expect(display.kind).toBe("words");
      if (display.kind === "words") {
        expect(display.trackActiveWord).toBe(true);
        expect(display.emphasisWordId).toBeNull();
        expect(display.words.map((w) => w.text)).toEqual(["Hello", ",", "world", "today"]);
      }
    }
  });

  it("attaches punctuation-only tokens to the previous word", () => {
    const display = resolveCaptionDisplay(segment, style("karaoke"));
    if (display.kind !== "words") throw new Error("expected words");
    expect(display.words.map((w) => w.spaceBefore)).toEqual([false, false, true, true]);
  });

  it("Highlight emphasizes a static word without tracking playback", () => {
    const display = resolveCaptionDisplay(segment, style("highlight"));
    if (display.kind !== "words") throw new Error("expected words");
    expect(display.trackActiveWord).toBe(false);
    expect(display.emphasisWordId).toBe("w4");
  });

  it("falls back to plain text when word timestamps are missing", () => {
    for (const preset of listStylePresets()) {
      expect(resolveCaptionDisplay({ ...segment, words: [] }, preset).kind).toBe("plain");
      expect(resolveCaptionDisplay({ ...segment, words: undefined as never }, preset).kind).toBe("plain");
    }
  });

  it("falls back to plain text (edited text shown) when words are stale", () => {
    const edited = { ...segment, text: "Edited text", wordsStale: true };
    expect(resolveCaptionDisplay(edited, style("karaoke"))).toEqual({ kind: "plain", text: "Edited text" });
  });

  it("falls back to plain text when word timing is malformed", () => {
    const bad = { ...segment, words: [{ id: "x", text: "x", startTime: 2, endTime: 1 }] };
    expect(resolveCaptionDisplay(bad, style("karaoke")).kind).toBe("plain");
  });
});
