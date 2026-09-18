import { describe, expect, it } from "vitest";

import { computeProgressPercent, extractLatestOutTimeSeconds } from "../parseFfmpegProgress";

// Fixture text shaped exactly like real `-progress pipe:1` output,
// verified directly against the project's installed ffmpeg build.
const realProgressChunk = `bitrate= 256.1kbits/s
total_size=160574
out_time_us=5015500
out_time_ms=5015500
out_time=00:00:05.015500
dup_frames=0
drop_frames=0
speed= 419x
progress=end
`;

describe("extractLatestOutTimeSeconds", () => {
  it("parses out_time=HH:MM:SS.ssssss into seconds", () => {
    expect(extractLatestOutTimeSeconds(realProgressChunk)).toBeCloseTo(5.0155, 3);
  });

  it("returns the latest value when multiple progress blocks are present", () => {
    const buffer = `out_time=00:00:01.000000\nprogress=continue\nout_time=00:00:07.500000\nprogress=continue\n`;
    expect(extractLatestOutTimeSeconds(buffer)).toBeCloseTo(7.5, 3);
  });

  it("handles hours correctly for long-form videos", () => {
    const buffer = `out_time=01:30:00.000000\nprogress=continue\n`;
    expect(extractLatestOutTimeSeconds(buffer)).toBeCloseTo(90 * 60, 3);
  });

  it("returns null when no out_time is present", () => {
    expect(extractLatestOutTimeSeconds("bitrate=100kbits/s\n")).toBeNull();
  });
});

describe("computeProgressPercent", () => {
  it("computes a real, clamped percentage", () => {
    expect(computeProgressPercent(5, 10)).toBe(50);
    expect(computeProgressPercent(0, 10)).toBe(0);
    expect(computeProgressPercent(10, 10)).toBe(100);
  });

  it("clamps above 100 (ffmpeg can slightly overshoot the reported duration)", () => {
    expect(computeProgressPercent(11, 10)).toBe(100);
  });

  it("returns 0 rather than dividing by zero when duration is unknown", () => {
    expect(computeProgressPercent(5, 0)).toBe(0);
  });
});
