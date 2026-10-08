import { describe, expect, it } from "vitest";

import { planAudioChunks } from "../planAudioChunks";

describe("planAudioChunks", () => {
  it("returns a single chunk when the total duration fits within one chunk", () => {
    expect(planAudioChunks(300, 600)).toEqual([{ index: 0, startSeconds: 0, endSeconds: 300 }]);
    expect(planAudioChunks(600, 600)).toEqual([{ index: 0, startSeconds: 0, endSeconds: 600 }]);
  });

  it("returns an empty plan for zero/negative/non-finite duration", () => {
    expect(planAudioChunks(0, 600)).toEqual([]);
    expect(planAudioChunks(-5, 600)).toEqual([]);
    expect(planAudioChunks(Number.NaN, 600)).toEqual([]);
  });

  it("throws for a non-positive chunk size", () => {
    expect(() => planAudioChunks(100, 0)).toThrow();
    expect(() => planAudioChunks(100, -1)).toThrow();
  });

  it("splits evenly-divisible audio into equal chunks", () => {
    const plan = planAudioChunks(1800, 600); // 3x 600s
    expect(plan).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 600 },
      { index: 1, startSeconds: 600, endSeconds: 1200 },
      { index: 2, startSeconds: 1200, endSeconds: 1800 },
    ]);
  });

  it("folds a small trailing remainder into the previous chunk instead of making a tiny extra one", () => {
    // 1250s with 600s chunks: 2 full chunks (1200s) + 50s remainder (< 25% of 600s) -> folded into chunk 1
    const plan = planAudioChunks(1250, 600);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ index: 0, startSeconds: 0, endSeconds: 600 });
    expect(plan[1]).toEqual({ index: 1, startSeconds: 600, endSeconds: 1250 });
  });

  it("gives a large remainder its own chunk", () => {
    // 1000s with 600s chunks: 600s + 400s remainder (> 25% of 600s) -> its own chunk
    const plan = planAudioChunks(1000, 600);
    expect(plan).toEqual([
      { index: 0, startSeconds: 0, endSeconds: 600 },
      { index: 1, startSeconds: 600, endSeconds: 1000 },
    ]);
  });

  it("matches the real benchmark shape: ~56.6 real minutes at the 10-minute default stays a handful of chunks", () => {
    const plan = planAudioChunks(3393.016, 600);
    expect(plan.length).toBeGreaterThanOrEqual(5);
    expect(plan.length).toBeLessThanOrEqual(7);
    expect(plan.every((c) => c.endSeconds - c.startSeconds <= 600 * 1.25)).toBe(true);
  });

  it("chunks are contiguous and cover the whole duration exactly, with no gap or overlap", () => {
    for (const total of [1, 599, 600, 601, 1234.5, 7199, 7200]) {
      const plan = planAudioChunks(total, 600);
      expect(plan[0].startSeconds).toBe(0);
      expect(plan.at(-1)!.endSeconds).toBeCloseTo(total, 9);
      for (let i = 1; i < plan.length; i++) expect(plan[i].startSeconds).toBe(plan[i - 1].endSeconds);
      plan.forEach((c, i) => expect(c.index).toBe(i));
    }
  });

  it("no chunk exceeds 1.25x the configured chunk duration", () => {
    for (const total of [1, 100, 599, 600, 601, 900, 1000, 1199, 1200, 1201, 5000, 7200]) {
      const plan = planAudioChunks(total, 600);
      for (const c of plan) expect(c.endSeconds - c.startSeconds).toBeLessThanOrEqual(600 * 1.25 + 1e-9);
    }
  });
});
