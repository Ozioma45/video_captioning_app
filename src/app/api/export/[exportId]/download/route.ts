import type { NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { exportOutputKey, loadExportJob } from "@/services/export/exportJobStore";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";

// Streams the rendered file with HTTP Range support — needs Node's fs.
export const runtime = "nodejs";

function parseRange(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;
  if (startText === "") {
    return { start: Math.max(0, totalSize - Number(endText)), end: totalSize - 1 };
  }
  return { start: Number(startText), end: endText === "" ? totalSize - 1 : Number(endText) };
}

/** RFC 6266 attachment header: an ASCII fallback plus the UTF-8 original. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  if (!isValidId(exportId)) {
    return new Response(null, { status: 404 });
  }

  // Only a completed, validated export is ever served; the file's location is derived from the validated id.
  const job = await loadExportJob(exportId);
  if (!job || job.status !== "completed" || !job.output) {
    return new Response(null, { status: 404 });
  }

  const key = exportOutputKey(exportId);
  if (!(await storageProvider.exists(key))) {
    return new Response(null, { status: 404 });
  }

  const totalSize = job.output.sizeBytes;
  const range = parseRange(request.headers.get("range"), totalSize);
  if (range && (range.start < 0 || range.end >= totalSize || range.start > range.end)) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
  }

  const effective = range ?? { start: 0, end: totalSize - 1 };
  const stream = await storageProvider.createReadStream(key, effective);

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": String(effective.end - effective.start + 1),
    "Content-Disposition": contentDisposition(job.output.filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (range) headers.set("Content-Range", `bytes ${effective.start}-${effective.end}/${totalSize}`);

  return new Response(stream, { status: range ? 206 : 200, headers });
}
