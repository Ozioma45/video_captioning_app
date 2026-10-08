import { describe, expect, it } from "vitest";

import { buildWhisperArgs } from "../buildWhisperArgs";

const base = {
  modelPath: "C:\\models\\ggml-tiny.en.bin",
  audioFilePath: "C:\\temp\\job-1\\audio.wav",
  language: "en",
  outputBasename: "C:\\temp\\job-1\\audio",
  threads: 8,
  beamSize: null,
  bestOf: null,
  reportProgress: false,
};

describe("buildWhisperArgs", () => {
  it("is a plain argument array, with paths as single elements (never a shell string)", () => {
    const evil = 'C:\\my "audio"\\a; rm -rf & echo `x` $(y).wav';
    const args = buildWhisperArgs({ ...base, audioFilePath: evil });
    expect(Array.isArray(args)).toBe(true);
    expect(args.every((a) => typeof a === "string")).toBe(true);
    expect(args[args.indexOf("-f") + 1]).toBe(evil);
  });

  it("never passes -nt (it destroys timestamps — see the code comment / ARCHITECTURE.md)", () => {
    expect(buildWhisperArgs(base)).not.toContain("-nt");
  });

  it("always requests full JSON output at the given basename", () => {
    const args = buildWhisperArgs(base);
    expect(args).toContain("-ojf");
    expect(args[args.indexOf("-of") + 1]).toBe(base.outputBasename);
  });

  it("passes the given thread count", () => {
    expect(buildWhisperArgs({ ...base, threads: 4 })).toEqual(expect.arrayContaining(["-t", "4"]));
    expect(buildWhisperArgs({ ...base, threads: 16 })).toEqual(expect.arrayContaining(["-t", "16"]));
  });

  it("omits -bs/-bo by default, deferring to whisper.cpp's own defaults", () => {
    const args = buildWhisperArgs(base);
    expect(args).not.toContain("-bs");
    expect(args).not.toContain("-bo");
  });

  it("passes -bs/-bo only when explicitly configured", () => {
    const args = buildWhisperArgs({ ...base, beamSize: 1, bestOf: 1 });
    expect(args).toEqual(expect.arrayContaining(["-bs", "1", "-bo", "1"]));
  });

  it("passes -pp only when progress reporting is requested", () => {
    expect(buildWhisperArgs({ ...base, reportProgress: false })).not.toContain("-pp");
    expect(buildWhisperArgs({ ...base, reportProgress: true })).toContain("-pp");
  });

  it("uses the given language hint", () => {
    expect(buildWhisperArgs({ ...base, language: "auto" })).toEqual(expect.arrayContaining(["-l", "auto"]));
  });
});
