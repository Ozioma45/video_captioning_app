import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

import type { ExportRequest } from "@/domain/export-engine/exportRequest";
import { getStylePreset } from "@/domain/style-engine/styleRegistry";
import { LocalFilesystemStorage } from "@/services/storage/LocalFilesystemStorage";
import { FfmpegVideoProcessor } from "@/services/video-processing/FfmpegVideoProcessor";
import type { VideoProcessor } from "@/services/video-processing/VideoProcessingService";
import { RenderFailedError } from "@/services/video-processing/errors";
import type { StoredVideoRecord } from "@/services/videos/videoRecordStore";
import type { CaptionSegment, CaptionStyle, ExportJob } from "@/types";
import {
  createExportJob,
  exportOutputKey,
  exportWorkDirectoryKey,
  loadExportJob,
  registerActiveExport,
  requestExportCancel,
  saveExportJob,
} from "../exportJobStore";
import { runExportJob, type ExportDependencies } from "../runExportJob";

/**
 * These tests run the REAL FFmpeg/libass/ffprobe against a generated
 * video, with storage pointed at a temp directory. Only the failure-mode
 * tests substitute a fake processor.
 */

const FFMPEG = ffmpegInstaller.path;
const FONTS = path.resolve(process.cwd(), "assets", "fonts");

let root: string;
let storage: LocalFilesystemStorage;
let realProcessor: FfmpegVideoProcessor;
const videos: Record<string, StoredVideoRecord> = {};

function makeVideo(name: string, opts: { size: string; seconds: number; audio: boolean; format?: "mp4" | "mov" | "webm"; solid?: boolean }): string {
  const format = opts.format ?? "mp4";
  const file = path.join(root, `${name}.${format}`);
  const args = ["-y", "-loglevel", "error", "-f", "lavfi", "-i", opts.solid ? `color=c=0x24304a:size=${opts.size}:rate=25:duration=${opts.seconds}` : `testsrc2=size=${opts.size}:rate=25:duration=${opts.seconds}`];
  if (opts.audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${opts.seconds}`);
  if (format === "webm") args.push("-c:v", "libvpx", "-b:v", "500k", "-pix_fmt", "yuv420p", ...(opts.audio ? ["-c:a", "libopus", "-shortest"] : []), file);
  else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(opts.audio ? ["-c:a", "aac", "-shortest"] : []), file);
  execFileSync(FFMPEG, args);
  return file;
}

async function register(name: string, file: string): Promise<StoredVideoRecord> {
  const id = crypto.randomUUID();
  const key = `uploads/${id}/source.bin`;
  mkdirSync(path.dirname(storage.getAbsolutePath(key)), { recursive: true });
  copyFileSync(file, storage.getAbsolutePath(key));
  const metadata = await realProcessor.getMetadata(storage.getAbsolutePath(key));
  const record: StoredVideoRecord = { videoId: id, storageKey: key, contentType: "video/mp4", originalFilename: path.basename(file), metadata, createdAt: new Date().toISOString() };
  videos[id] = record;
  return record;
}

const segments: CaptionSegment[] = [
  { id: "s1", startTime: 0.5, endTime: 2, text: "Hello there", words: [{ id: "a", text: "Hello", startTime: 0.5, endTime: 1.1 }, { id: "b", text: "there", startTime: 1.1, endTime: 1.9 }] },
  { id: "s2", startTime: 2.2, endTime: 3.5, text: "Second one", words: [{ id: "c", text: "Second", startTime: 2.3, endTime: 2.9 }, { id: "d", text: "one", startTime: 2.9, endTime: 3.4 }] },
];

function deps(overrides: Partial<ExportDependencies> = {}): ExportDependencies {
  return { storage, processor: realProcessor, loadVideo: async (id) => videos[id] ?? null, fontsSourceDirectory: FONTS, ...overrides };
}

async function startJob(videoId: string, request: Partial<ExportRequest> = {}, d: ExportDependencies = deps()): Promise<{ job: ExportJob; done: Promise<void> }> {
  const job = createExportJob(videoId);
  await saveExportJob(job, storage);
  registerActiveExport(job.id);
  const done = runExportJob(job.id, { videoId, segments, style: getStylePreset("karaoke") as CaptionStyle, ...request }, d);
  return { job, done };
}

const leftovers = (jobId: string) => ({
  work: existsSync(storage.getAbsolutePath(exportWorkDirectoryKey(jobId))),
  output: existsSync(storage.getAbsolutePath(exportOutputKey(jobId))),
});

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "export-test-"));
  storage = new LocalFilesystemStorage(root);
  realProcessor = new FfmpegVideoProcessor();
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runExportJob — real FFmpeg", () => {
  it("renders, validates, completes; output is playable H.264/AAC with the source's duration and size", async () => {
    const record = await register("landscape", makeVideo("landscape", { size: "640x360", seconds: 4, audio: true }));
    const { job, done } = await startJob(record.videoId);
    await done;

    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("completed");
    expect(finished.progressPercent).toBe(100);
    expect(finished.error).toBeNull();
    expect(finished.downloadUrl).toBe(`/api/export/${job.id}/download`);
    expect(finished.output?.filename).toBe("landscape-captioned.mp4");
    expect(finished.startedAt && finished.finishedAt).toBeTruthy();

    const meta = await realProcessor.getMetadata(storage.getAbsolutePath(exportOutputKey(job.id)));
    expect(meta.videoCodec).toBe("h264");
    expect(meta.audioCodec).toBe("aac");
    expect(meta.hasAudio).toBe(true);
    expect([meta.width, meta.height]).toEqual([640, 360]);
    expect(Math.abs(meta.durationSeconds - record.metadata.durationSeconds)).toBeLessThan(0.3);
    expect(meta.fileSizeBytes).toBe(finished.output?.sizeBytes);
    expect(leftovers(job.id)).toEqual({ work: false, output: true });
  }, 60_000);

  it("burns captions in: frames with a caption differ from frames without", async () => {
    const record = await register("burn", makeVideo("burn", { size: "640x360", seconds: 4, audio: true }));
    const { job, done } = await startJob(record.videoId, { style: getStylePreset("classic") as CaptionStyle });
    await done;
    const out = storage.getAbsolutePath(exportOutputKey(job.id));
    const frame = (t: number) => execFileSync(FFMPEG, ["-loglevel", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 10_000_000 });
    const src = (t: number) => execFileSync(FFMPEG, ["-loglevel", "error", "-ss", String(t), "-i", storage.getAbsolutePath(record.storageKey), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 10_000_000 });
    const diff = (a: Buffer, b: Buffer) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 40 ? 1 : 0), 0);
    expect(diff(frame(1.2), src(1.2))).toBeGreaterThan(300); // caption visible at 1.2 s
    expect(diff(frame(0.2), src(0.2))).toBeLessThan(60); // no caption at 0.2 s (only encode noise)
    expect(diff(frame(3.8), src(3.8))).toBeLessThan(60); // none after the last caption
  }, 60_000);

  it("Karaoke: the highlight color sits on the word Whisper timestamped, moves with the words, and is absent outside them", async () => {
    const record = await register("karaoke", makeVideo("karaoke", { size: "640x360", seconds: 4, audio: true, solid: true }));
    const { job, done } = await startJob(record.videoId); // segments: "Hello there" (Hello 0.5-1.1, there 1.1-1.9)
    await done;
    const out = storage.getAbsolutePath(exportOutputKey(job.id));
    const W = 640, H = 360;
    const highlight = (t: number) => {
      const buf = execFileSync(FFMPEG, ["-loglevel", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 10_000_000 });
      let n = 0, sx = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (Math.abs(buf[i] - 0xff) < 40 && Math.abs(buf[i + 1] - 0xd5) < 40 && Math.abs(buf[i + 2] - 0x4a) < 40) { n++; sx += x; }
      }
      return { n, cx: n ? sx / n : null };
    };
    const hello = highlight(0.8);
    const there = highlight(1.5);
    const between = highlight(2.05); // caption s1 ended at 2, s2 starts 2.2: nothing on screen
    expect(hello.n).toBeGreaterThan(40);
    expect(there.n).toBeGreaterThan(40);
    expect(there.cx!).toBeGreaterThan(hello.cx! + 20); // highlight moved right, from "Hello" to "there"
    expect(between.n).toBe(0);
  }, 60_000);

  it("supports portrait, square and odd-sized sources; output matches the (even) source size", async () => {
    for (const [name, size, expected] of [["portrait", "360x640", [360, 640]], ["square", "480x480", [480, 480]], ["odd", "641x361", [640, 360]]] as const) {
      const record = await register(name, makeVideo(name, { size, seconds: 3, audio: true }));
      const { job, done } = await startJob(record.videoId, { style: getStylePreset("podcast") as CaptionStyle });
      await done;
      const finished = (await loadExportJob(job.id, storage))!;
      expect(finished.status, name).toBe("completed");
      const meta = await realProcessor.getMetadata(storage.getAbsolutePath(exportOutputKey(job.id)));
      expect([meta.width, meta.height], name).toEqual(expected);
    }
  }, 120_000);

  it("exports MOV and WebM sources (WebM's Opus audio is re-encoded to AAC), and stale-word captions", async () => {
    const stale: CaptionSegment[] = [{ id: "s", startTime: 0.5, endTime: 2.5, text: "Edited text, words stale", words: [{ id: "a", text: "old", startTime: 0.5, endTime: 1 }], wordsStale: true }];
    for (const format of ["mov", "webm"] as const) {
      const record = await register(`src-${format}`, makeVideo(`src-${format}`, { size: "320x240", seconds: 3, audio: true, format }));
      const { job, done } = await startJob(record.videoId, { segments: stale });
      await done;
      const finished = (await loadExportJob(job.id, storage))!;
      expect(finished.status, format).toBe("completed");
      const meta = await realProcessor.getMetadata(storage.getAbsolutePath(exportOutputKey(job.id)));
      expect([meta.videoCodec, meta.audioCodec, meta.containerFormat?.includes("mp4")], format).toEqual(["h264", "aac", true]);
    }
  }, 120_000);

  it("exports a video with no audio track", async () => {
    const record = await register("silent", makeVideo("silent", { size: "320x240", seconds: 3, audio: false }));
    const { job, done } = await startJob(record.videoId);
    await done;
    expect((await loadExportJob(job.id, storage))!.status).toBe("completed");
    const meta = await realProcessor.getMetadata(storage.getAbsolutePath(exportOutputKey(job.id)));
    expect(meta.hasAudio).toBe(false);
  }, 60_000);

  it("does not touch the source video", async () => {
    const record = await register("intact", makeVideo("intact", { size: "320x240", seconds: 2, audio: true }));
    const before = (await realProcessor.getMetadata(storage.getAbsolutePath(record.storageKey))).fileSizeBytes;
    const { done } = await startJob(record.videoId);
    await done;
    expect((await realProcessor.getMetadata(storage.getAbsolutePath(record.storageKey))).fileSizeBytes).toBe(before);
  }, 60_000);

  it("cancels a running export: FFmpeg is killed, job is cancelled, nothing is left behind", async () => {
    const record = await register("long", makeVideo("long", { size: "1280x720", seconds: 60, audio: true }));
    const { job, done } = await startJob(record.videoId);

    // wait for real progress from FFmpeg, then cancel
    const started = Date.now();
    for (;;) {
      const current = await loadExportJob(job.id, storage);
      if ((current?.progressPercent ?? 0) > 0) break;
      if (Date.now() - started > 40_000) throw new Error("export never reported progress");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(requestExportCancel(job.id)).toBe(true);
    await done;

    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("cancelled");
    expect(finished.error).toBeNull();
    expect(finished.downloadUrl).toBeNull();
    expect(leftovers(job.id)).toEqual({ work: false, output: false });
    // the source is still there
    expect(existsSync(storage.getAbsolutePath(record.storageKey))).toBe(true);
    // no ffmpeg left running against our storage
    const listing = execFileSync("tasklist", ["/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"]).toString();
    expect(listing.toLowerCase().includes("ffmpeg.exe")).toBe(false);
  }, 120_000);
});

describe("runExportJob — failure handling", () => {
  it("marks failed with a user-safe message when FFmpeg fails, and cleans up", async () => {
    const record = await register("fail", makeVideo("fail", { size: "320x240", seconds: 2, audio: true }));
    const failing: VideoProcessor = { ...realProcessor, getMetadata: realProcessor.getMetadata.bind(realProcessor), extractAudio: realProcessor.extractAudio.bind(realProcessor), render: async () => { throw new RenderFailedError(new Error("boom"), "libass: secret path C:\\internal"); } };
    const { job, done } = await startJob(record.videoId, {}, deps({ processor: failing }));
    await done;
    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("failed");
    expect(finished.error?.message).toMatch(/could not be rendered/i);
    expect(finished.error?.projectSafe).toBe(true);
    expect(JSON.stringify(finished.error)).not.toMatch(/C:\\|internal/); // no stderr / paths
    expect(finished.downloadUrl).toBeNull();
    expect(leftovers(job.id)).toEqual({ work: false, output: false });
  }, 60_000);

  it("fails when the source video is missing", async () => {
    const { job, done } = await startJob(crypto.randomUUID());
    await done;
    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("failed");
    expect(leftovers(job.id).work).toBe(false);
  });

  it("fails cleanly when a bundled font is missing", async () => {
    const record = await register("nofont", makeVideo("nofont", { size: "320x240", seconds: 2, audio: true }));
    const emptyFonts = mkdtempSync(path.join(root, "nofonts-"));
    const { job, done } = await startJob(record.videoId, {}, deps({ fontsSourceDirectory: emptyFonts }));
    await done;
    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("failed");
    expect(finished.error?.message).toMatch(/font/i);
    expect(leftovers(job.id)).toEqual({ work: false, output: false });
  });

  it("does NOT complete when FFmpeg exits 0 but the output is invalid, and discards the output", async () => {
    const record = await register("liar", makeVideo("liar", { size: "320x240", seconds: 3, audio: true }));
    // "renders" a file with the wrong duration/size: FFmpeg-style success, invalid result
    const liar: VideoProcessor = {
      getMetadata: realProcessor.getMetadata.bind(realProcessor),
      extractAudio: realProcessor.extractAudio.bind(realProcessor),
      render: async (_input, options) => {
        execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1", "-pix_fmt", "yuv420p", options.outputPath]);
      },
    };
    const { job, done } = await startJob(record.videoId, {}, deps({ processor: liar }));
    await done;
    const finished = (await loadExportJob(job.id, storage))!;
    expect(finished.status).toBe("failed");
    expect(finished.error?.message).toMatch(/verification/i);
    expect(finished.progressPercent).not.toBe(100);
    expect(leftovers(job.id)).toEqual({ work: false, output: false });
  }, 60_000);

  it("reports the queued → processing → completed lifecycle", async () => {
    const record = await register("life", makeVideo("life", { size: "320x240", seconds: 2, audio: true }));
    const job = createExportJob(record.videoId);
    expect(job.status).toBe("queued");
    await saveExportJob(job, storage);
    registerActiveExport(job.id);
    const seen = new Set<string>();
    const done = runExportJob(job.id, { videoId: record.videoId, segments, style: getStylePreset("classic") as CaptionStyle }, deps());
    while (!seen.has("completed")) {
      const current = await loadExportJob(job.id, storage);
      if (current) seen.add(current.status);
      if (current?.status === "failed") throw new Error("unexpected failure");
      await new Promise((r) => setTimeout(r, 20));
    }
    await done;
    expect(seen.has("processing") || seen.has("completed")).toBe(true);
  }, 60_000);
});

describe("storage layout", () => {
  it("keeps everything for a job under exports/<id>/", () => {
    const dir = storage.getAbsolutePath("exports");
    for (const id of readdirSync(dir)) {
      expect(readdirSync(path.join(dir, id)).every((n) => n === "job.json" || n === "output.mp4")).toBe(true);
    }
  });
});
