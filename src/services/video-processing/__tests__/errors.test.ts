import { describe, expect, it } from "vitest";

import {
  AudioExtractionFailedError,
  classifyFfmpegExecError,
  classifyFfprobeExecError,
  FfmpegUnavailableError,
  FfprobeUnavailableError,
  UnreadableVideoError,
} from "../errors";

describe("classifyFfprobeExecError", () => {
  it("classifies a string errno code (ffprobe could not even be launched) as unavailable, not invalid", () => {
    // This is the exact bug this test guards against: a 2026-09-17
    // incident where a stale dev-server process could no longer launch
    // ffprobe correctly, and every non-ENOENT exec failure was being
    // reported to the user as "invalid video" for a perfectly valid file.
    for (const code of ["ENOENT", "EACCES", "ENOTDIR"]) {
      const error = Object.assign(new Error("spawn failed"), { code });
      const classified = classifyFfprobeExecError(error);
      expect(classified).toBeInstanceOf(FfprobeUnavailableError);
    }
  });

  it("classifies a numeric exit code (ffprobe ran and rejected the file) as an invalid video", () => {
    const error = Object.assign(new Error("Command failed"), { code: 1, stderr: "Invalid data found" });
    const classified = classifyFfprobeExecError(error);
    expect(classified).toBeInstanceOf(UnreadableVideoError);
  });

  it("defaults to invalid video when no code is present at all", () => {
    const classified = classifyFfprobeExecError(new Error("something else"));
    expect(classified).toBeInstanceOf(UnreadableVideoError);
  });
});

describe("classifyFfmpegExecError", () => {
  it("classifies a string errno code as ffmpeg being unavailable, not an extraction failure (Phase 3)", () => {
    for (const code of ["ENOENT", "EACCES"]) {
      const error = Object.assign(new Error("spawn failed"), { code });
      expect(classifyFfmpegExecError(error)).toBeInstanceOf(FfmpegUnavailableError);
    }
  });

  it("classifies a numeric exit code as a real audio-extraction failure", () => {
    const error = Object.assign(new Error("Command failed"), { code: 1, stderr: "Invalid data found" });
    expect(classifyFfmpegExecError(error)).toBeInstanceOf(AudioExtractionFailedError);
  });
});
