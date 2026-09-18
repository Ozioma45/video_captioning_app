import { describe, expect, it } from "vitest";

import { classifyWhisperExecError, TranscriptionProcessError, WhisperUnavailableError } from "../errors";

describe("classifyWhisperExecError", () => {
  it("classifies a string errno code as whisper.cpp being unavailable, not a transcription failure", () => {
    for (const code of ["ENOENT", "EACCES"]) {
      const error = Object.assign(new Error("spawn failed"), { code });
      expect(classifyWhisperExecError(error)).toBeInstanceOf(WhisperUnavailableError);
    }
  });

  it("classifies a numeric exit code as a real transcription process failure", () => {
    const error = Object.assign(new Error("Command failed"), { code: 1, stderr: "failed to load audio" });
    expect(classifyWhisperExecError(error)).toBeInstanceOf(TranscriptionProcessError);
  });
});
