import { beforeEach, describe, expect, it } from "vitest";

import type { CaptionDocument, CaptionSegment, CaptionWord } from "@/types";
import { DEFAULT_SEGMENTATION_RULES } from "@/domain/caption-engine/segmentationRules";
import { useCaptionStore } from "../useCaptionStore";
import { useProjectStore } from "../useProjectStore";

let nextId = 0;
function word(text: string, startTime: number, endTime: number): CaptionWord {
  nextId += 1;
  return { id: `w${nextId}`, text, startTime, endTime };
}

function segment(id: string, text: string, words: CaptionWord[]): CaptionSegment {
  return { id, startTime: words[0].startTime, endTime: words[words.length - 1].endTime, text, words };
}

function buildDocument(segments: CaptionSegment[]): CaptionDocument {
  return {
    id: "doc1",
    videoId: "video1",
    language: "en",
    originalWords: segments.flatMap((s) => s.words),
    segmentationRules: DEFAULT_SEGMENTATION_RULES,
    segments,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function threeSegmentDoc(): CaptionDocument {
  return buildDocument([
    segment("s1", "one", [word("one", 0, 1)]),
    segment("s2", "two", [word("two", 1, 2)]),
    segment("s3", "three", [word("three", 2, 3)]),
  ]);
}

beforeEach(() => {
  useCaptionStore.getState().reset();
  useProjectStore.getState().reset();
});

describe("useCaptionStore selection", () => {
  it("selects a segment by id", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s2");
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s2");
  });

  it("clears selection when a new document is loaded", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s2");
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    expect(useCaptionStore.getState().selectedSegmentId).toBeNull();
  });
});

describe("useCaptionStore navigation", () => {
  it("selects the first caption when navigating next with nothing selected", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectNextCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s1");
  });

  it("moves forward through captions", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s1");
    useCaptionStore.getState().selectNextCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s2");
  });

  it("does not move past the last caption", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s3");
    useCaptionStore.getState().selectNextCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s3");
  });

  it("moves backward through captions", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s3");
    useCaptionStore.getState().selectPreviousCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s2");
  });

  it("does not move before the first caption", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().selectSegment("s1");
    useCaptionStore.getState().selectPreviousCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBe("s1");
  });

  it("does nothing when there is no document", () => {
    useCaptionStore.getState().selectNextCaption();
    expect(useCaptionStore.getState().selectedSegmentId).toBeNull();
  });
});

describe("useCaptionStore editing", () => {
  it("updates the selected caption's text", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().updateText("s2", "TWO");
    expect(useCaptionStore.getState().captionDocument?.segments[1].text).toBe("TWO");
    expect(useCaptionStore.getState().lastError).toBeNull();
  });

  it("surfaces an error for an unknown segment id without throwing", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    expect(() => useCaptionStore.getState().updateText("does-not-exist", "x")).not.toThrow();
    expect(useCaptionStore.getState().lastError).toBeTruthy();
  });

  it("updates timing using the live video duration from useProjectStore", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useProjectStore.getState().setVideo({
      id: "11111111-1111-4111-8111-111111111111",
      source: { kind: "server-path", videoId: "11111111-1111-4111-8111-111111111111" },
      metadata: {
        filename: "clip.mp4",
        fileSizeBytes: 1000,
        durationSeconds: 3,
        width: 100,
        height: 100,
        frameRate: 30,
        videoCodec: "h264",
        hasAudio: true,
        audioCodec: "aac",
        containerFormat: "mp4",
      },
      uploadedAt: new Date().toISOString(),
    });

    // s3 ends at 3s already; pushing it to 10s should be rejected since it exceeds the known 3s video duration.
    useCaptionStore.getState().updateTiming("s3", 2, 10);
    expect(useCaptionStore.getState().lastError).toBeTruthy();
    expect(useCaptionStore.getState().captionDocument?.segments[2].endTime).toBe(3);
  });
});

describe("useCaptionStore split/merge", () => {
  it("splits the selected caption and selects the first half", () => {
    const doc = buildDocument([segment("s1", "a b", [word("a", 0, 1), word("b", 1, 2)])]);
    useCaptionStore.getState().setCaptionDocument(doc);
    useCaptionStore.getState().split("s1", 1);

    const segments = useCaptionStore.getState().captionDocument?.segments ?? [];
    expect(segments).toHaveLength(2);
    expect(useCaptionStore.getState().selectedSegmentId).toBe(segments[0].id);
  });

  it("merges two captions and selects the merged result", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    useCaptionStore.getState().merge("s1", "s2");

    const segments = useCaptionStore.getState().captionDocument?.segments ?? [];
    expect(segments).toHaveLength(2);
    expect(useCaptionStore.getState().selectedSegmentId).toBe(segments[0].id);
  });

  it("surfaces an error instead of throwing when merging non-adjacent captions", () => {
    useCaptionStore.getState().setCaptionDocument(threeSegmentDoc());
    expect(() => useCaptionStore.getState().merge("s1", "s3")).not.toThrow();
    expect(useCaptionStore.getState().lastError).toBeTruthy();
    // Document is unchanged on a rejected merge.
    expect(useCaptionStore.getState().captionDocument?.segments).toHaveLength(3);
  });
});
