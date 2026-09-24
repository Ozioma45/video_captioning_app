import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";

import { getStylePreset } from "@/domain/style-engine/styleRegistry";
import { createExportJob, exportOutputKey, saveExportJob, updateExportJob } from "@/services/export/exportJobStore";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import { POST as startExport } from "../route";
import { GET as getStatus } from "../[exportId]/route";
import { POST as cancelExport } from "../[exportId]/cancel/route";
import { GET as download } from "../[exportId]/download/route";

/** Route-handler tests against the real handlers and the real (project) storage root, cleaning up what they create. */

const created: string[] = [];
afterAll(() => {
  for (const id of created) rmSync(storageProvider.getAbsolutePath(`exports/${id}`), { recursive: true, force: true });
});

const params = (exportId: string) => ({ params: Promise.resolve({ exportId }) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/export", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

const validBody = (over: Record<string, unknown> = {}) => ({
  videoId: crypto.randomUUID(),
  captionDocument: { segments: [{ id: "s", startTime: 0, endTime: 1, text: "hi", words: [{ id: "w", text: "hi", startTime: 0, endTime: 1 }] }] },
  styleConfig: { baseStyleId: "classic", style: getStylePreset("classic") },
  ...over,
});

async function makeCompleted(bytes = 1000): Promise<string> {
  const job = createExportJob(crypto.randomUUID());
  created.push(job.id);
  const dir = storageProvider.getAbsolutePath(`exports/${job.id}`);
  mkdirSync(dir, { recursive: true });
  const data = Buffer.alloc(bytes, 7);
  writeFileSync(path.join(dir, "output.mp4"), data);
  await saveExportJob(
    updateExportJob(job, {
      status: "completed",
      progressPercent: 100,
      output: { filename: "Ünï cöde \"talk\".mp4", sizeBytes: bytes, durationSeconds: 1 },
      downloadUrl: `/api/export/${job.id}/download`,
      error: { message: "m", projectSafe: true, detail: "SECRET-DETAIL" },
    }),
  );
  return job.id;
}

describe("POST /api/export — input validation", () => {
  it("rejects a non-JSON body", async () => {
    expect((await startExport(post("not json"))).status).toBe(400);
  });
  it("rejects a missing or malformed videoId", async () => {
    expect((await startExport(post(validBody({ videoId: undefined })))).status).toBe(422);
    expect((await startExport(post(validBody({ videoId: "../../etc/passwd" })))).status).toBe(422);
    expect((await startExport(post(validBody({ videoId: "not-a-uuid" })))).status).toBe(422);
  });
  it("rejects a missing or empty caption document", async () => {
    expect((await startExport(post(validBody({ captionDocument: undefined })))).status).toBe(422);
    expect((await startExport(post(validBody({ captionDocument: { segments: [] } })))).status).toBe(422);
  });
  it("rejects malformed caption timing", async () => {
    const bad = { segments: [{ id: "s", startTime: 5, endTime: 1, text: "x", words: [] }] };
    expect((await startExport(post(validBody({ captionDocument: bad })))).status).toBe(422);
    const nan = { segments: [{ id: "s", startTime: "0", endTime: 1, text: "x", words: [] }] };
    expect((await startExport(post(validBody({ captionDocument: nan })))).status).toBe(422);
  });
  it("rejects an invalid style configuration", async () => {
    const style = { ...(getStylePreset("classic") as object), typography: { fontFamily: "comic-sans", fontSize: 9999, fontWeight: 123, letterSpacing: 0, lineHeight: 1, textTransform: "none" } };
    const res = await startExport(post(validBody({ styleConfig: { baseStyleId: "x", style } })));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_style");
    expect((await startExport(post(validBody({ styleConfig: undefined })))).status).toBe(422);
    expect((await startExport(post(validBody({ styleConfig: { style: { colors: {} } } })))).status).toBe(422);
  });
  it("returns 404 for a well-formed but unknown video", async () => {
    expect((await startExport(post(validBody()))).status).toBe(404);
  });
  it("rejects an oversized request", async () => {
    const res = await startExport(post(validBody(), { "content-length": String(500 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });
  it("never accepts a client-supplied path or ffmpeg argument", async () => {
    const res = await startExport(post(validBody({ outputPath: "/tmp/x", ffmpegArgs: ["-i", "/etc/passwd"] })));
    expect(res.status).toBe(404); // unknown video, and the extra fields are simply ignored (never read)
  });
});

describe("GET /api/export/[id]", () => {
  it("404s on malformed and unknown ids", async () => {
    expect((await getStatus(new NextRequest("http://x"), params("../../etc"))).status).toBe(404);
    expect((await getStatus(new NextRequest("http://x"), params(crypto.randomUUID()))).status).toBe(404);
  });
  it("returns job state without technical error detail", async () => {
    const id = await makeCompleted();
    const res = await getStatus(new NextRequest("http://x"), params(id));
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(JSON.stringify(json)).not.toContain("SECRET-DETAIL");
  });
});

describe("POST /api/export/[id]/cancel", () => {
  it("404s on malformed and unknown ids", async () => {
    expect((await cancelExport(new NextRequest("http://x", { method: "POST" }), params("..%2F.."))).status).toBe(404);
    expect((await cancelExport(new NextRequest("http://x", { method: "POST" }), params(crypto.randomUUID()))).status).toBe(404);
  });
  it("refuses to cancel an export that already finished", async () => {
    const id = await makeCompleted();
    expect((await cancelExport(new NextRequest("http://x", { method: "POST" }), params(id))).status).toBe(409);
  });
  it("settles a stale 'processing' job that nothing is running", async () => {
    const job = createExportJob(crypto.randomUUID());
    created.push(job.id);
    await saveExportJob(updateExportJob(job, { status: "processing", progressPercent: 10 }));
    const res = await cancelExport(new NextRequest("http://x", { method: "POST" }), params(job.id));
    expect(res.status).toBe(200);
    expect((await (await getStatus(new NextRequest("http://x"), params(job.id))).json()).status).toBe("cancelled");
  });
});

describe("GET /api/export/[id]/download", () => {
  it("404s on malformed ids and path-traversal attempts", async () => {
    for (const id of ["../../../etc/passwd", "..\\..\\secret", "%2e%2e%2f", "a".repeat(200), "", "00000000-0000-0000-0000-00000000000/../x"]) {
      expect((await download(new NextRequest("http://x"), params(id))).status, id).toBe(404);
    }
  });
  it("404s for unknown, queued and failed exports", async () => {
    expect((await download(new NextRequest("http://x"), params(crypto.randomUUID()))).status).toBe(404);
    const job = createExportJob(crypto.randomUUID());
    created.push(job.id);
    await saveExportJob(job);
    expect((await download(new NextRequest("http://x"), params(job.id))).status).toBe(404);
    await saveExportJob(updateExportJob(job, { status: "failed" }));
    expect((await download(new NextRequest("http://x"), params(job.id))).status).toBe(404);
  });
  it("serves a completed export as a streamed attachment with safe headers", async () => {
    const id = await makeCompleted(1000);
    const res = await download(new NextRequest("http://x"), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    expect(disposition).not.toMatch(/filename="[^"]*"[^;]*"/); // the quote in the name was neutralized
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });
  it("supports HTTP Range requests", async () => {
    const id = await makeCompleted(1000);
    const partial = await download(new NextRequest("http://x", { headers: { range: "bytes=100-199" } }), params(id));
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(partial.headers.get("Content-Length")).toBe("100");
    expect((await partial.arrayBuffer()).byteLength).toBe(100);
    const suffix = await download(new NextRequest("http://x", { headers: { range: "bytes=-50" } }), params(id));
    expect(suffix.headers.get("Content-Range")).toBe("bytes 950-999/1000");
    const bad = await download(new NextRequest("http://x", { headers: { range: "bytes=5000-6000" } }), params(id));
    expect(bad.status).toBe(416);
  });
  it("does not serve a completed job whose file is gone", async () => {
    const id = await makeCompleted();
    rmSync(storageProvider.getAbsolutePath(exportOutputKey(id)));
    expect((await download(new NextRequest("http://x"), params(id))).status).toBe(404);
  });
});
