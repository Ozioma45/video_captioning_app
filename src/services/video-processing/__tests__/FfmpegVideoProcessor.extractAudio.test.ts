import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegVideoProcessor } from "../FfmpegVideoProcessor";

const execFileAsync = promisify(execFile);

/**
 * Real integration test, not a mock — `@ffmpeg-installer/ffmpeg` is an
 * always-installed npm dependency (unlike whisper.cpp), so this is safe
 * to run in CI/on any machine. Generates its own ~1s synthetic clip with
 * `lavfi` rather than depending on a committed video fixture (PROJECT.md:
 * don't commit large video fixtures).
 */
describe("FfmpegVideoProcessor.extractAudio (real ffmpeg)", () => {
  let tempDir: string;
  let sourceVideoPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "extract-audio-test-"));
    sourceVideoPath = path.join(tempDir, "source.mp4");
    await execFileAsync(ffmpegInstaller.path, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      sourceVideoPath,
    ]);
  }, 30_000);

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("produces a real 16kHz mono PCM WAV that ffprobe confirms", async () => {
    const processor = new FfmpegVideoProcessor();
    const outputPath = path.join(tempDir, "audio.wav");
    const progressUpdates: number[] = [];

    await processor.extractAudio(sourceVideoPath, outputPath, {
      durationSeconds: 1,
      onProgress: (percent) => progressUpdates.push(percent),
    });

    const stats = await stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);

    const { stdout } = await execFileAsync(ffprobeInstaller.path, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      outputPath,
    ]);
    const probed = JSON.parse(stdout) as { streams: Array<{ sample_rate: string; channels: number; codec_name: string }> };

    expect(probed.streams).toHaveLength(1);
    expect(probed.streams[0].sample_rate).toBe("16000");
    expect(probed.streams[0].channels).toBe(1);
    expect(probed.streams[0].codec_name).toBe("pcm_s16le");
  }, 30_000);

  it("creates the destination directory when it doesn't exist yet", async () => {
    // Regression test: a real E2E run (2026-09-18) against a job's
    // never-before-used temp directory failed with ffmpeg's own "No such
    // file or directory", because nothing had created that directory yet
    // — the earlier test above never caught this since mkdtemp already
    // creates its directory. This mirrors the real job-runner shape:
    // `temp/{jobId}/audio.wav` where `temp/{jobId}/` doesn't exist yet.
    const processor = new FfmpegVideoProcessor();
    const outputPath = path.join(tempDir, "never-created-yet", "nested", "audio.wav");

    await processor.extractAudio(sourceVideoPath, outputPath, { durationSeconds: 1 });

    const stats = await stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30_000);
});
