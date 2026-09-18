import { describe, expect, it } from "vitest";

import { isSpawnFailure } from "../execErrorClassification";

describe("isSpawnFailure", () => {
  it("treats a string errno code as a spawn-level failure", () => {
    expect(isSpawnFailure(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true);
  });

  it("treats a numeric exit code as the process having actually run", () => {
    expect(isSpawnFailure(Object.assign(new Error("x"), { code: 1 }))).toBe(false);
  });

  it("treats a missing code as not a spawn failure", () => {
    expect(isSpawnFailure(new Error("x"))).toBe(false);
  });
});
