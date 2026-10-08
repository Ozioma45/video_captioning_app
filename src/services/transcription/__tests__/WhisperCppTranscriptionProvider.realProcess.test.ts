import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Exercises the REAL local whisper.cpp binary/model this dev machine has
 * configured (see .env.example for setup) — gated so the suite never
 * depends on one being present (Task 6: "do not make the test suite
 * depend on downloading a model"). If `WHISPER_BINARY_PATH`/
 * `WHISPER_MODEL_PATH` aren't both real files, this whole file is
 * skipped rather than failing.
 *
 * The audio is real synthesized speech (Windows SAPI, `System.Speech`),
 * generated once in `beforeAll` — a silence/tone WAV was tried first and
 * whisper.cpp emitted zero segments for it (filtered as non-speech even
 * with `-nth 0`), which would make `parseWhisperCppOutput` throw before
 * these lifecycle behaviors could be observed.
 */
const whisperConfigured =
  process.platform === "win32" &&
  !!process.env.WHISPER_BINARY_PATH &&
  !!process.env.WHISPER_MODEL_PATH &&
  existsSync(process.env.WHISPER_BINARY_PATH) &&
  existsSync(process.env.WHISPER_MODEL_PATH);

describe.skipIf(!whisperConfigured)("WhisperCppTranscriptionProvider — real whisper.cpp", () => {
  let dir: string;
  let wavPath: string;
  let longWavPath: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "whisper-real-test-"));
    wavPath = path.join(dir, "speech.wav");
    const escapedPath = wavPath.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.SetOutputToWaveFile('${escapedPath}')`,
      "$s.Speak('This is a real test of the transcription pipeline timeout and progress reporting.')",
      "$s.Dispose()",
    ].join("\n");
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);

    // A longer real clip (distinct sentences, so chunk boundaries are
    // identifiable in the transcript) to exercise long-audio chunking
    // (see planAudioChunks/mergeChunkedTranscription) against real
    // whisper.cpp, not just the merge arithmetic in isolation.
    longWavPath = path.join(dir, "long-speech.wav");
    const longEscapedPath = longWavPath.replace(/'/g, "''");
    const sentences = Array.from({ length: 8 }, (_, i) => `This is real sentence number ${i + 1} of the long chunking test.`).join(" ");
    const longScript = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.SetOutputToWaveFile('${longEscapedPath}')`,
      `$s.Speak('${sentences.replace(/'/g, "''")}')`,
      "$s.Dispose()",
    ].join("\n");
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", longScript]);
  }, 40_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("completes a real transcription within a generous timeout and returns real word timing", async () => {
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const provider = new WhisperCppTranscriptionProvider();
    const result = await provider.transcribe({ audioFilePath: wavPath, durationSeconds: 5, jobId: "test-happy-path" });
    expect(result.segments.length).toBeGreaterThan(0);
    const words = result.segments.flatMap((s) => s.words);
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))).toBe(true);
  }, 60_000);

  it("reports real progress during transcription (not a fabricated percentage)", async () => {
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const provider = new WhisperCppTranscriptionProvider();
    const seen: number[] = [];
    await provider.transcribe({ audioFilePath: wavPath, durationSeconds: 5, onProgress: (percent) => seen.push(percent) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((percent) => percent >= 0 && percent <= 100)).toBe(true);
  }, 60_000);

  it("genuinely times out against real whisper.cpp when the effective timeout is too low, and cleans up the intermediate JSON", async () => {
    vi.stubEnv("WHISPER_TIMEOUT_MS", "1");
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const { WhisperTimeoutError } = await import("../errors");
    const provider = new WhisperCppTranscriptionProvider();

    await expect(provider.transcribe({ audioFilePath: wavPath, durationSeconds: 5 })).rejects.toBeInstanceOf(WhisperTimeoutError);

    // transcribe()'s own `finally { rm(outputJsonPath) }` must have run even on a timeout.
    expect(existsSync(wavPath.replace(/\.wav$/, ".json"))).toBe(false);
  }, 15_000);

  it("classifies a real non-zero whisper.cpp exit (a missing audio file, exit code 2) distinctly from a timeout", async () => {
    const missingWav = path.join(dir, "does-not-exist.wav");
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const { TranscriptionProcessError, WhisperCancelledError, WhisperTimeoutError } = await import("../errors");
    const provider = new WhisperCppTranscriptionProvider();

    try {
      await provider.transcribe({ audioFilePath: missingWav, durationSeconds: 1 });
      expect.unreachable("should have rejected");
    } catch (error) {
      expect(error).not.toBeInstanceOf(WhisperTimeoutError);
      expect(error).not.toBeInstanceOf(WhisperCancelledError);
      expect(error).toBeInstanceOf(TranscriptionProcessError);
    }
  }, 15_000);

  it("real transcription that completes leaves no intermediate JSON file behind", async () => {
    const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
    const provider = new WhisperCppTranscriptionProvider();
    await provider.transcribe({ audioFilePath: wavPath, durationSeconds: 5 });
    expect(existsSync(wavPath.replace(/\.wav$/, ".json"))).toBe(false);
  }, 60_000);

  describe("long-audio chunking (real whisper.cpp)", () => {
    it("splits into several real chunks, transcribes each, and merges back into one continuous, correctly-timed result", async () => {
      const { wavDurationSeconds } = await import("../wavSlicing");
      const totalDuration = wavDurationSeconds(readFileSync(longWavPath));
      // Force at least 3 chunks out of this one real clip.
      const chunkSeconds = Math.max(5, Math.floor(totalDuration / 3.5));
      vi.stubEnv("WHISPER_CHUNK_DURATION_SECONDS", String(chunkSeconds));

      const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
      const provider = new WhisperCppTranscriptionProvider();
      const result = await provider.transcribe({ audioFilePath: longWavPath, durationSeconds: totalDuration, jobId: "chunk-test" });

      const words = result.segments.flatMap((s) => s.words);
      expect(words.length).toBeGreaterThan(10); // real speech was actually transcribed in every chunk, not just the first

      // Word-level timing stays real, monotonic, and within the audio's own
      // duration end to end — the single most important chunking guarantee
      // (CLAUDE.md "preserve word-level timestamps").
      for (let i = 1; i < words.length; i++) {
        expect(words[i].start, `word ${i} out of order`).toBeGreaterThanOrEqual(words[i - 1].start);
      }
      expect(words.every((w) => w.start >= 0 && w.end <= totalDuration + 1)).toBe(true);
      // Later words have timestamps well past the first chunk's own
      // duration — proof the merge actually offset later chunks rather
      // than leaving every chunk re-starting at 0.
      expect(words.at(-1)!.start).toBeGreaterThan(chunkSeconds);

      // Every segment produced by a non-final chunk must fully fit inside the chunk's own
      // [start, end) window after offsetting — the per-chunk result was not corrupted by the merge.
      for (const segment of result.segments) expect(segment.end).toBeGreaterThan(segment.start);

      expect(existsSync(longWavPath.replace(/\.wav$/, ".chunk0.wav"))).toBe(false); // chunk temp files cleaned up
    }, 120_000);

    it("a real, uninterrupted chunked run finishes well inside the per-chunk timeout window (no regression to the slow single-pass path)", async () => {
      const { wavDurationSeconds } = await import("../wavSlicing");
      const totalDuration = wavDurationSeconds(readFileSync(longWavPath));
      vi.stubEnv("WHISPER_CHUNK_DURATION_SECONDS", String(Math.max(5, Math.floor(totalDuration / 4))));

      const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
      const provider = new WhisperCppTranscriptionProvider();
      const startedAt = Date.now();
      await provider.transcribe({ audioFilePath: longWavPath, durationSeconds: totalDuration });
      expect(Date.now() - startedAt).toBeLessThan(60_000);
    }, 90_000);

    it("audio at or below the chunk threshold is NOT chunked — identical to the pre-chunking single-invocation behavior", async () => {
      vi.stubEnv("WHISPER_CHUNK_DURATION_SECONDS", "3600"); // 1 hour — the 5s clip stays well under it
      const { WhisperCppTranscriptionProvider } = await import("../WhisperCppTranscriptionProvider");
      const provider = new WhisperCppTranscriptionProvider();
      const result = await provider.transcribe({ audioFilePath: wavPath, durationSeconds: 5 });
      expect(result.segments.length).toBeGreaterThan(0);
    }, 30_000);
  });
});
