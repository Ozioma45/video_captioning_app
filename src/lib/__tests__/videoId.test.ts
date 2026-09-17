import { describe, expect, it } from "vitest";

import { isValidVideoId } from "../videoId";

describe("isValidVideoId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidVideoId("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects path traversal attempts disguised as a videoId", () => {
    expect(isValidVideoId("../../etc/passwd")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(isValidVideoId("not-a-uuid")).toBe(false);
    expect(isValidVideoId("")).toBe(false);
  });
});
