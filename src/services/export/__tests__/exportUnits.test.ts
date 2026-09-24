import { describe, expect, it } from "vitest";

import { validateExportRequest } from "@/domain/export-engine/exportRequest";
import { getStylePreset } from "@/domain/style-engine/styleRegistry";
import { buildRenderArgs } from "@/services/video-processing/buildRenderArgs";
import { parseFfprobeOutput } from "@/services/video-processing/parseFfprobeOutput";
import type { RenderOptions } from "@/services/video-processing/VideoProcessingService";
import type { VideoMetadata } from "@/types";
import { exportDownloadFilename, toExportError } from "../runExportJob";
import { ExportFontMissingError } from "../errors";
import { toEvenSize, validateExportOutput } from "../validateExportOutput";

const renderOptions = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  workingDirectory: "C:\\work dir\\job",
  subtitleFileName: "captions.ass",
  fontsDirectoryName: "fonts",
  outputPath: "C:\\work dir\\job\\render.mp4",
  source: { durationSeconds: 10, hasAudio: true, audioCodec: "aac" },
  outputSize: { width: 1280, height: 720 },
  ...over,
});

describe("buildRenderArgs", () => {
  it("is an argument array whose paths are single elements (spaces, quotes, colons stay intact)", () => {
    const evil = 'C:\\my "videos"\\a; rm -rf & echo `x` $(y).mp4';
    const args = buildRenderArgs(evil, renderOptions());
    expect(Array.isArray(args)).toBe(true);
    expect(args[args.indexOf("-i") + 1]).toBe(evil);
    expect(args.at(-1)).toBe("C:\\work dir\\job\\render.mp4");
  });

  it("builds the filter from constants and integers only; caption text never appears", () => {
    const args = buildRenderArgs("in.mp4", renderOptions());
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=1280:720,ass=captions.ass:fontsdir=fonts");
  });

  it("copies AAC audio, re-encodes other audio, and tolerates no audio", () => {
    expect(buildRenderArgs("i", renderOptions()).join(" ")).toContain("-c:a copy");
    expect(buildRenderArgs("i", renderOptions({ source: { durationSeconds: 1, hasAudio: true, audioCodec: "opus" } })).join(" ")).toContain("-c:a aac");
    expect(buildRenderArgs("i", renderOptions({ source: { durationSeconds: 1, hasAudio: false, audioCodec: null } })).join(" ")).toContain("0:a:0?");
  });

  it("re-encodes video as H.264 yuv420p MP4 with faststart and real progress output", () => {
    const joined = buildRenderArgs("i", renderOptions()).join(" ");
    for (const part of ["-c:v libx264", "-pix_fmt yuv420p", "-movflags +faststart", "-progress pipe:1"]) expect(joined).toContain(part);
  });

  it("refuses unsafe filter file names and invalid sizes", () => {
    expect(() => buildRenderArgs("i", renderOptions({ subtitleFileName: "a.ass,drawtext=text=x" }))).toThrow();
    expect(() => buildRenderArgs("i", renderOptions({ fontsDirectoryName: "../fonts" }))).toThrow();
    expect(() => buildRenderArgs("i", renderOptions({ outputSize: { width: 0, height: 10 } }))).toThrow();
    expect(() => buildRenderArgs("i", renderOptions({ outputSize: { width: 10.5, height: 10 } }))).toThrow();
  });
});

const meta = (over: Partial<VideoMetadata> = {}): VideoMetadata => ({
  filename: "o.mp4", fileSizeBytes: 5000, durationSeconds: 10, width: 640, height: 360, frameRate: 25,
  videoCodec: "h264", hasAudio: true, audioCodec: "aac", containerFormat: "mov,mp4,m4a,3gp,3g2,mj2", ...over,
});
const expected = { durationSeconds: 10, hasAudio: true, width: 640, height: 360 };

describe("validateExportOutput", () => {
  it("accepts a good file", () => expect(validateExportOutput(meta(), expected)).toEqual([]));
  it("rejects empty, wrong codec/container, missing or extra audio, wrong size, wrong duration", () => {
    expect(validateExportOutput(meta({ fileSizeBytes: 0 }), expected)).toHaveLength(1);
    expect(validateExportOutput(meta({ videoCodec: "vp9" }), expected)).toHaveLength(1);
    expect(validateExportOutput(meta({ containerFormat: "matroska,webm" }), expected)).toHaveLength(1);
    expect(validateExportOutput(meta({ hasAudio: false, audioCodec: null }), expected)).toEqual(["audio track is missing"]);
    expect(validateExportOutput(meta(), { ...expected, hasAudio: false })).toEqual(["unexpected audio track"]);
    expect(validateExportOutput(meta({ width: 320 }), expected)).toHaveLength(1);
    expect(validateExportOutput(meta({ durationSeconds: 7 }), expected)).toHaveLength(1);
    expect(validateExportOutput(meta({ durationSeconds: Number.NaN }), expected)).toHaveLength(1);
  });
  it("tolerates small duration drift", () => {
    expect(validateExportOutput(meta({ durationSeconds: 10.4 }), expected)).toEqual([]);
  });
  it("makes odd sizes even", () => {
    expect(toEvenSize(641, 361)).toEqual({ width: 640, height: 360 });
    expect(toEvenSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("export error mapping and filenames", () => {
  it("never leaks raw errors or paths to the user", () => {
    const err = toExportError(new Error("ENOENT: no such file C:\\Users\\HP\\secret\\x.mp4"));
    expect(JSON.stringify(err)).not.toContain("secret");
    expect(err.projectSafe).toBe(true);
    expect(toExportError(new ExportFontMissingError("Inter-W600.ttf")).message).toMatch(/font/i);
  });
  it("derives a safe download name", () => {
    expect(exportDownloadFilename("My Talk.mov")).toBe("My Talk-captioned.mp4");
    expect(exportDownloadFilename("../../evil.mp4")).toBe("evil-captioned.mp4");
    expect(exportDownloadFilename("")).toBe("video-captioned.mp4");
  });
});

describe("validateExportRequest", () => {
  const id = crypto.randomUUID();
  const good = () => ({
    videoId: id,
    captionDocument: { segments: [{ id: "s", startTime: 0, endTime: 1, text: "hi", words: [{ id: "w", text: "hi", startTime: 0, endTime: 1 }], junk: "x" }] },
    styleConfig: { baseStyleId: "classic", style: getStylePreset("classic") },
  });

  it("accepts a valid request and copies only known fields", () => {
    const result = validateExportRequest(good());
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value.segments[0]).sort()).toEqual(["endTime", "id", "startTime", "text", "words"]);
  });
  it("rejects malformed shapes and hostile values", () => {
    const cases: unknown[] = [null, [], "x", { ...good(), videoId: 5 }, { ...good(), captionDocument: { segments: "x" } }];
    for (const c of cases) expect(validateExportRequest(c).ok).toBe(false);
    const g = good();
    g.captionDocument.segments[0].words[0].startTime = Infinity;
    expect(validateExportRequest(g).ok).toBe(false);
    const h = good();
    h.captionDocument.segments[0].text = "x".repeat(10_000);
    expect(validateExportRequest(h).ok).toBe(false);
    const o = good();
    o.captionDocument.segments.push({ id: "t", startTime: -1, endTime: 0, text: "a", words: [], junk: "" });
    expect(validateExportRequest(o).ok).toBe(false);
  });
  it("requires ordered segments", () => {
    const g = good();
    g.captionDocument.segments.unshift({ id: "late", startTime: 5, endTime: 6, text: "a", words: [], junk: "" });
    expect(validateExportRequest(g).ok).toBe(false);
  });
  it("rejects styles with bad colors or fonts", () => {
    const g = good();
    const style = structuredClone(getStylePreset("classic")) as unknown as { colors: { text: string } };
    style.colors.text = "red; drop table";
    expect(validateExportRequest({ ...g, styleConfig: { baseStyleId: "classic", style } }).ok).toBe(false);
    const missingGroups = { ...g, styleConfig: { baseStyleId: "classic", style: { id: "x", name: "x" } } };
    expect(validateExportRequest(missingGroups).ok).toBe(false);
  });
});

describe("parseFfprobeOutput display size (rotation)", () => {
  const stream = (extra: object) => ({ streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1", ...extra }], format: { duration: "5", format_name: "mov,mp4" } });
  it("swaps width/height for 90/270 degree rotation (tag or side data)", () => {
    expect(parseFfprobeOutput(stream({ tags: { rotate: "90" } }))).toMatchObject({ width: 1080, height: 1920 });
    expect(parseFfprobeOutput(stream({ side_data_list: [{ rotation: -90 }] }))).toMatchObject({ width: 1080, height: 1920 });
    expect(parseFfprobeOutput(stream({ tags: { rotate: "270" } }))).toMatchObject({ width: 1080, height: 1920 });
  });
  it("leaves 0/180 degree and unrotated video alone", () => {
    expect(parseFfprobeOutput(stream({}))).toMatchObject({ width: 1920, height: 1080 });
    expect(parseFfprobeOutput(stream({ tags: { rotate: "180" } }))).toMatchObject({ width: 1920, height: 1080 });
    expect(parseFfprobeOutput(stream({ tags: { rotate: "nonsense" } }))).toMatchObject({ width: 1920, height: 1080 });
  });
});
