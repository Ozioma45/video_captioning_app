import { describe, expect, it } from "vitest";

import { generateId, isValidId } from "../id";

describe("generateId", () => {
  it("produces ids that pass isValidId", () => {
    expect(isValidId(generateId())).toBe(true);
  });
});

describe("isValidId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidId("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects path traversal attempts disguised as an id", () => {
    expect(isValidId("../../etc/passwd")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
    expect(isValidId("")).toBe(false);
  });
});
