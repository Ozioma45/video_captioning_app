import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exercise the real, un-mocked configuration-check path
 * (Phase 3 brief §2, §15: "a missing Whisper model must result in a
 * clear setup/configuration error, NOT an 'invalid video' error", and
 * "test missing model configuration / missing executable handling").
 * They never spawn whisper.cpp itself — every case here fails (or
 * succeeds, for isWhisperConfigured) before a process would be spawned.
 *
 * Env vars are read at module load time in config/whisper.ts, so each
 * test stubs the environment and re-imports fresh via `vi.resetModules`.
 */
describe("WhisperCppTranscriptionProvider configuration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "whisper-config-test-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("throws WhisperBinaryMissingError when neither path is configured", async () => {
    vi.stubEnv("WHISPER_BINARY_PATH", "");
    vi.stubEnv("WHISPER_MODEL_PATH", "");
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const { WhisperBinaryMissingError } = await import("../errors");

    const provider = new WhisperCppTranscriptionProvider();
    await expect(provider.transcribe({ audioFilePath: "irrelevant.wav" })).rejects.toBeInstanceOf(
      WhisperBinaryMissingError,
    );
  });

  it("throws WhisperBinaryMissingError when the configured binary path doesn't exist on disk", async () => {
    const modelPath = path.join(tempDir, "model.bin");
    await writeFile(modelPath, "fake-model-bytes");
    vi.stubEnv("WHISPER_BINARY_PATH", path.join(tempDir, "does-not-exist.exe"));
    vi.stubEnv("WHISPER_MODEL_PATH", modelPath);

    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const { WhisperBinaryMissingError } = await import("../errors");

    const provider = new WhisperCppTranscriptionProvider();
    await expect(provider.transcribe({ audioFilePath: "irrelevant.wav" })).rejects.toBeInstanceOf(
      WhisperBinaryMissingError,
    );
  });

  it("throws WhisperModelMissingError when the binary exists but the model path doesn't", async () => {
    const binaryPath = path.join(tempDir, "whisper.exe");
    await writeFile(binaryPath, "fake-binary-bytes");
    vi.stubEnv("WHISPER_BINARY_PATH", binaryPath);
    vi.stubEnv("WHISPER_MODEL_PATH", path.join(tempDir, "does-not-exist.bin"));

    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const { WhisperModelMissingError } = await import("../errors");

    const provider = new WhisperCppTranscriptionProvider();
    await expect(provider.transcribe({ audioFilePath: "irrelevant.wav" })).rejects.toBeInstanceOf(
      WhisperModelMissingError,
    );
  });

  it("never throws an 'invalid video'-shaped error for a configuration problem", async () => {
    vi.stubEnv("WHISPER_BINARY_PATH", "");
    vi.stubEnv("WHISPER_MODEL_PATH", "");
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");

    const provider = new WhisperCppTranscriptionProvider();
    try {
      await provider.transcribe({ audioFilePath: "irrelevant.wav" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).name).not.toMatch(/invalid|unreadable/i);
    }
  });

  it("isWhisperConfigured is true only when both paths point at real files", async () => {
    const binaryPath = path.join(tempDir, "whisper.exe");
    const modelPath = path.join(tempDir, "model.bin");
    await writeFile(binaryPath, "fake-binary-bytes");
    await writeFile(modelPath, "fake-model-bytes");
    vi.stubEnv("WHISPER_BINARY_PATH", binaryPath);
    vi.stubEnv("WHISPER_MODEL_PATH", modelPath);

    const { isWhisperConfigured } = await import("../WhisperCppTranscriptionProvider");
    expect(await isWhisperConfigured()).toBe(true);
  });

  it("isWhisperConfigured is false when unset", async () => {
    vi.stubEnv("WHISPER_BINARY_PATH", "");
    vi.stubEnv("WHISPER_MODEL_PATH", "");
    const { isWhisperConfigured } = await import("../WhisperCppTranscriptionProvider");
    expect(await isWhisperConfigured()).toBe(false);
  });
});
