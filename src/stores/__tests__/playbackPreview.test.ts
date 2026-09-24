import { beforeEach, describe, expect, it, vi } from "vitest";

import { findActiveSegment, findActiveWord } from "@/domain/caption-engine/captionLookup";
import { resolveCaptionDisplay } from "@/domain/style-engine/captionDisplay";
import { DEFAULT_SEGMENTATION_RULES } from "@/domain/caption-engine/segmentationRules";
import type { CaptionDocument, CaptionWord } from "@/types";
import { useCaptionStore } from "../useCaptionStore";
import { usePlaybackStore } from "../usePlaybackStore";
import { useStyleStore } from "../useStyleStore";

const w = (id: string, text: string, startTime: number, endTime: number): CaptionWord => ({ id, text, startTime, endTime });

const words1 = [w("a1", "Hello", 1, 1.5), w("a2", "there", 1.5, 2), w("a3", "friend", 2, 3)];
const words2 = [w("b1", "Second", 5, 5.5), w("b2", "caption", 5.5, 6)];

function makeDocument(): CaptionDocument {
  return {
    id: "doc",
    videoId: "v",
    language: "en",
    originalWords: [...words1, ...words2],
    segmentationRules: DEFAULT_SEGMENTATION_RULES,
    segments: [
      { id: "s1", startTime: 1, endTime: 3, text: "Hello there friend", words: words1 },
      { id: "s2", startTime: 5, endTime: 6, text: "Second caption", words: words2 },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** What the overlay derives on every render: (document, time) → active segment. */
function activeAt(time: number) {
  const segments = useCaptionStore.getState().captionDocument?.segments ?? [];
  return findActiveSegment(segments, time);
}

beforeEach(() => {
  useCaptionStore.getState().reset();
  usePlaybackStore.getState().reset();
  useStyleStore.getState().reset();
  useCaptionStore.getState().setCaptionDocument(makeDocument());
});

describe("playback-driven preview state", () => {
  it("follows playback time, including seeking backward and forward", () => {
    const { setCurrentTime } = usePlaybackStore.getState();
    setCurrentTime(1.2);
    expect(activeAt(usePlaybackStore.getState().currentTime)?.id).toBe("s1");
    setCurrentTime(5.1);
    expect(activeAt(usePlaybackStore.getState().currentTime)?.id).toBe("s2");
    setCurrentTime(4);
    expect(activeAt(usePlaybackStore.getState().currentTime)).toBeNull();
    setCurrentTime(2.5);
    expect(activeAt(usePlaybackStore.getState().currentTime)?.id).toBe("s1");
  });

  it("does not touch the caption document or notify subscribers on redundant time syncs", () => {
    const before = useCaptionStore.getState().captionDocument;
    const listener = vi.fn();
    usePlaybackStore.getState().setCurrentTime(2);
    const unsubscribe = usePlaybackStore.subscribe(listener);
    usePlaybackStore.getState().setCurrentTime(2);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(useCaptionStore.getState().captionDocument).toBe(before);
  });

  it("selecting a caption does not change playback state", () => {
    usePlaybackStore.getState().setCurrentTime(0);
    useCaptionStore.getState().selectSegment("s2");
    expect(usePlaybackStore.getState().currentTime).toBe(0);
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });

  it("shows edited text (plain, highlight disabled) immediately after a text edit", () => {
    useCaptionStore.getState().updateText("s1", "Hello brand new friend");
    const segment = activeAt(1.2)!;
    expect(segment.text).toBe("Hello brand new friend");
    const display = resolveCaptionDisplay(segment, useStyleStore.getState().styleConfig.style);
    expect(display).toEqual({ kind: "plain", text: "Hello brand new friend" });
    useStyleStore.getState().selectStyle("karaoke");
    expect(resolveCaptionDisplay(segment, useStyleStore.getState().styleConfig.style).kind).toBe("plain");
    expect(findActiveWord(segment, 1.2)).toBeNull();
  });

  it("uses the new timing after a timing edit", () => {
    useCaptionStore.getState().updateTiming("s2", 7, 8);
    expect(activeAt(5.2)).toBeNull();
    expect(activeAt(7.5)?.id).toBe("s2");
  });

  it("renders both halves after a split, with real word timing for each", () => {
    useCaptionStore.getState().split("s1", 1);
    const first = activeAt(1.2)!;
    const second = activeAt(2.5)!;
    expect(first.id).not.toBe(second.id);
    expect(first.text).toBe("Hello");
    expect(second.text).toBe("there friend");
    expect(findActiveWord(second, 2.5)?.id).toBe("a3");
  });

  it("renders the merged caption after a merge", () => {
    useCaptionStore.getState().merge("s1", "s2");
    const merged = activeAt(5.2)!;
    expect(merged.text).toContain("Second caption");
    expect(activeAt(3.5)?.id).toBe(merged.id); // merged span covers the former gap
  });

  it("style changes alter the rendering decision without touching captions", () => {
    const before = useCaptionStore.getState().captionDocument;
    const segment = activeAt(1.2)!;
    const kinds: string[] = [];
    for (const id of ["classic", "karaoke", "dynamic", "highlight", "podcast"]) {
      useStyleStore.getState().selectStyle(id);
      kinds.push(resolveCaptionDisplay(segment, useStyleStore.getState().styleConfig.style).kind);
    }
    expect(kinds).toEqual(["plain", "words", "words", "words", "plain"]);
    expect(useCaptionStore.getState().captionDocument).toBe(before);
  });
});
