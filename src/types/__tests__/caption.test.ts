import { describe, expect, it } from "vitest";

import type { CaptionDocument, CaptionWord } from "../caption";

function buildFixtureDocument(): CaptionDocument {
  const words: CaptionWord[] = [
    { id: "w1", text: "Welcome", startTime: 0.2, endTime: 0.75 },
    { id: "w2", text: "to", startTime: 0.76, endTime: 0.9 },
    { id: "w3", text: "my", startTime: 0.91, endTime: 1.05 },
    { id: "w4", text: "channel", startTime: 1.06, endTime: 1.55 },
  ];

  return {
    id: "doc1",
    videoId: "video1",
    language: "en",
    originalWords: words,
    segmentationRules: {
      maxWordsPerSegment: 8,
      maxCharsPerLine: 40,
      maxLines: 2,
      minSegmentDurationSeconds: 0.5,
      maxSegmentDurationSeconds: 6,
      breakOnPunctuation: true,
    },
    segments: [
      {
        id: "seg1",
        startTime: words[0].startTime,
        endTime: words[words.length - 1].endTime,
        text: "Welcome to my channel",
        words,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("CaptionDocument shape", () => {
  it("preserves word-level timing on every segment", () => {
    const doc = buildFixtureDocument();
    for (const segment of doc.segments) {
      expect(segment.words.length).toBeGreaterThan(0);
      for (const word of segment.words) {
        expect(typeof word.startTime).toBe("number");
        expect(typeof word.endTime).toBe("number");
        expect(word.endTime).toBeGreaterThan(word.startTime);
      }
    }
  });

  it("keeps originalWords independent from edited segment text", () => {
    const doc = buildFixtureDocument();
    doc.segments[0].text = "Hey everyone, welcome to my channel";
    expect(doc.originalWords.map((w) => w.text).join(" ")).toBe("Welcome to my channel");
  });
});
