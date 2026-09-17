import { describe, expect, it } from "vitest";

import { MAX_VIDEO_FILE_SIZE_BYTES } from "@/config/limits";

import { getFileExtension, validateVideoFileClientSide } from "../validateVideoFile";

describe("getFileExtension", () => {
  it("returns the lowercased extension", () => {
    expect(getFileExtension("Clip.MP4")).toBe("mp4");
  });

  it("returns an empty string when there is no extension", () => {
    expect(getFileExtension("clip")).toBe("");
  });
});

describe("validateVideoFileClientSide", () => {
  it("accepts a normal mp4 file", () => {
    const result = validateVideoFileClientSide({ name: "interview.mp4", size: 50_000_000, type: "video/mp4" });
    expect(result.valid).toBe(true);
  });

  it("accepts a file with an empty MIME type if the extension is a candidate format", () => {
    // Some browsers report an empty type for .mkv files.
    const result = validateVideoFileClientSide({ name: "clip.mkv", size: 1_000, type: "" });
    expect(result.valid).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = validateVideoFileClientSide({ name: "empty.mp4", size: 0, type: "video/mp4" });
    expect(result).toEqual({ valid: false, reason: expect.stringContaining("empty") });
  });

  it("rejects a file larger than the configured maximum", () => {
    const result = validateVideoFileClientSide({
      name: "huge.mp4",
      size: MAX_VIDEO_FILE_SIZE_BYTES + 1,
      type: "video/mp4",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a non-video file", () => {
    const result = validateVideoFileClientSide({ name: "notes.txt", size: 1_000, type: "text/plain" });
    expect(result.valid).toBe(false);
  });
});
