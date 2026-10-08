import { describe, expect, it } from "vitest";

import { extractLatestWhisperProgressPercent, stripWhisperProgressLines } from "../parseWhisperProgress";

describe("extractLatestWhisperProgressPercent", () => {
  it("returns null when no progress line is present", () => {
    expect(extractLatestWhisperProgressPercent("")).toBeNull();
    expect(extractLatestWhisperProgressPercent("load_backend: loaded CPU backend\n")).toBeNull();
  });

  it("parses a single progress line", () => {
    expect(extractLatestWhisperProgressPercent("whisper_print_progress_callback: progress =  64%\n")).toBe(64);
  });

  it("returns the LATEST value when several are present", () => {
    const buffer = [
      "whisper_print_progress_callback: progress =  10%",
      "whisper_print_progress_callback: progress =  53%",
      "whisper_print_progress_callback: progress =  86%",
    ].join("\n");
    expect(extractLatestWhisperProgressPercent(buffer)).toBe(86);
  });

  it("clamps a value whisper.cpp reports past 100% right before exit (observed: 107%)", () => {
    expect(extractLatestWhisperProgressPercent("whisper_print_progress_callback: progress = 107%")).toBe(100);
  });

  it("clamps to 0 at minimum (defensive; whisper.cpp does not emit negatives)", () => {
    expect(extractLatestWhisperProgressPercent("whisper_print_progress_callback: progress = 0%")).toBe(0);
  });

  it("ignores transcript text interleaved on the same buffer", () => {
    const buffer =
      " Hello everyone, and welcome back.whisper_print_progress_callback: progress =  21%\n Thanks for watching.whisper_print_progress_callback: progress =  43%";
    expect(extractLatestWhisperProgressPercent(buffer)).toBe(43);
  });
});

describe("stripWhisperProgressLines", () => {
  it("removes progress lines but keeps everything else", () => {
    const text = ["real error: something broke", "whisper_print_progress_callback: progress =  50%", "more diagnostic output"].join("\n");
    const stripped = stripWhisperProgressLines(text);
    expect(stripped).not.toContain("progress_callback");
    expect(stripped).toContain("real error: something broke");
    expect(stripped).toContain("more diagnostic output");
  });

  it("is a no-op when there are no progress lines", () => {
    expect(stripWhisperProgressLines("plain stderr text")).toBe("plain stderr text");
  });

  it("handles many progress lines without losing a real error at the end", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `whisper_print_progress_callback: progress =  ${i}%`);
    lines.push("FATAL: out of memory");
    const stripped = stripWhisperProgressLines(lines.join("\n"));
    expect(stripped).toContain("FATAL: out of memory");
    expect(stripped).not.toContain("progress_callback");
  });
});
