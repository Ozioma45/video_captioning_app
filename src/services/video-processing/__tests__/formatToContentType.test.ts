import { describe, expect, it } from "vitest";

import { resolveContentType } from "../formatToContentType";

describe("resolveContentType", () => {
  it("maps an mp4/mov container to video/mp4", () => {
    expect(resolveContentType("mov,mp4,m4a,3gp,3g2,mj2", "application/octet-stream")).toBe("video/mp4");
  });

  it("maps a matroska container to video/x-matroska", () => {
    expect(resolveContentType("matroska,webm", "application/octet-stream")).toBe("video/webm");
  });

  it("falls back to the declared content type when the container is unrecognized", () => {
    expect(resolveContentType("weird_format", "video/custom")).toBe("video/custom");
  });

  it("falls back to octet-stream when nothing is known", () => {
    expect(resolveContentType(null, "")).toBe("application/octet-stream");
  });
});
