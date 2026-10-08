import { cpus } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Env vars are read at module load time, so each test stubs the environment and re-imports fresh. */
describe("config/whisper", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("WHISPER_THREADS", () => {
    it("defaults to the number of logical CPUs (free parallelism, not an accuracy trade-off)", async () => {
      vi.stubEnv("WHISPER_THREADS", "");
      const { WHISPER_THREADS } = await import("../whisper");
      expect(WHISPER_THREADS).toBe(Math.max(1, cpus().length || 1));
    });

    it("honors an explicit override", async () => {
      vi.stubEnv("WHISPER_THREADS", "2");
      const { WHISPER_THREADS } = await import("../whisper");
      expect(WHISPER_THREADS).toBe(2);
    });

    it("ignores a nonsense override and falls back to the CPU count", async () => {
      vi.stubEnv("WHISPER_THREADS", "not-a-number");
      const { WHISPER_THREADS } = await import("../whisper");
      expect(WHISPER_THREADS).toBe(Math.max(1, cpus().length || 1));
    });
  });

  describe("WHISPER_BEAM_SIZE / WHISPER_BEST_OF", () => {
    it("default to null — whisper.cpp's own defaults apply, never changed silently", async () => {
      vi.stubEnv("WHISPER_BEAM_SIZE", "");
      vi.stubEnv("WHISPER_BEST_OF", "");
      const { WHISPER_BEAM_SIZE, WHISPER_BEST_OF } = await import("../whisper");
      expect(WHISPER_BEAM_SIZE).toBeNull();
      expect(WHISPER_BEST_OF).toBeNull();
    });

    it("honor an explicit override", async () => {
      vi.stubEnv("WHISPER_BEAM_SIZE", "1");
      vi.stubEnv("WHISPER_BEST_OF", "1");
      const { WHISPER_BEAM_SIZE, WHISPER_BEST_OF } = await import("../whisper");
      expect(WHISPER_BEAM_SIZE).toBe(1);
      expect(WHISPER_BEST_OF).toBe(1);
    });
  });

  describe("computeWhisperTimeoutMs", () => {
    it("is NOT derived from duration alone: it adds overhead and divides by an assumed speed factor", async () => {
      vi.stubEnv("WHISPER_TIMEOUT_MS", "");
      vi.stubEnv("WHISPER_TIMEOUT_OVERHEAD_MS", "60000");
      vi.stubEnv("WHISPER_MIN_SPEED_FACTOR", "0.5");
      vi.stubEnv("WHISPER_TIMEOUT_OVERHEAD_MS", "60000");
      vi.stubEnv("WHISPER_TIMEOUT_MIN_MS", "1");
      vi.stubEnv("WHISPER_TIMEOUT_MAX_MS", String(24 * 60 * 60 * 1000));
      const { computeWhisperTimeoutMs } = await import("../whisper");
      // 100s of audio / 0.5 speed factor = 200s budget, + 60s overhead = 260s
      expect(computeWhisperTimeoutMs(100)).toBe(260_000);
    });

    it("clamps to the configured minimum for a short/unknown duration", async () => {
      vi.stubEnv("WHISPER_TIMEOUT_MS", "");
      vi.stubEnv("WHISPER_TIMEOUT_MIN_MS", "300000");
      const { computeWhisperTimeoutMs } = await import("../whisper");
      expect(computeWhisperTimeoutMs(0)).toBe(300_000);
      expect(computeWhisperTimeoutMs(-5)).toBe(300_000);
      expect(computeWhisperTimeoutMs(Number.NaN)).toBe(300_000);
    });

    it("clamps to the configured maximum for a very long duration", async () => {
      vi.stubEnv("WHISPER_TIMEOUT_MS", "");
      vi.stubEnv("WHISPER_TIMEOUT_MAX_MS", "600000");
      const { computeWhisperTimeoutMs } = await import("../whisper");
      expect(computeWhisperTimeoutMs(100_000)).toBe(600_000);
    });

    it("an explicit WHISPER_TIMEOUT_MS wins outright over the duration-aware calculation", async () => {
      vi.stubEnv("WHISPER_TIMEOUT_MS", "42000");
      const { computeWhisperTimeoutMs } = await import("../whisper");
      expect(computeWhisperTimeoutMs(100_000)).toBe(42_000);
      expect(computeWhisperTimeoutMs(0)).toBe(42_000);
    });

    it("scales up for a longer video, within the clamp", async () => {
      vi.stubEnv("WHISPER_TIMEOUT_MS", "");
      vi.stubEnv("WHISPER_TIMEOUT_MIN_MS", "0");
      vi.stubEnv("WHISPER_TIMEOUT_MAX_MS", String(24 * 60 * 60 * 1000));
      const { computeWhisperTimeoutMs } = await import("../whisper");
      const short = computeWhisperTimeoutMs(60);
      const long = computeWhisperTimeoutMs(6000);
      expect(long).toBeGreaterThan(short);
    });
  });
});
