import { describe, expect, it } from "vitest";

import { sanitizeDisplayFilename } from "../sanitize";

describe("sanitizeDisplayFilename", () => {
  it("keeps a normal filename as-is", () => {
    expect(sanitizeDisplayFilename("interview.mp4")).toBe("interview.mp4");
  });

  it("strips path separators, keeping only the last segment", () => {
    expect(sanitizeDisplayFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayFilename("C:\\Users\\me\\video.mp4")).toBe("video.mp4");
  });

  it("strips control characters", () => {
    expect(sanitizeDisplayFilename("clip\u0000.mp4")).toBe("clip.mp4");
  });

  it("falls back to a default name for an empty result", () => {
    expect(sanitizeDisplayFilename("")).toBe("video");
  });
});
