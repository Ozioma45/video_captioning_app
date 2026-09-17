import type { NextRequest } from "next/server";

import { isValidVideoId } from "@/lib/videoId";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";
import { loadVideoRecord } from "@/services/videos/videoRecordStore";

// Serves video bytes with HTTP Range support so the browser can seek a
// long file without downloading it in full — needs Node's fs, not edge.
export const runtime = "nodejs";

function parseRange(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    // Suffix range, e.g. "bytes=-500" -> last 500 bytes.
    const suffixLength = Number(endText);
    return { start: Math.max(0, totalSize - suffixLength), end: totalSize - 1 };
  }

  const start = Number(startText);
  const end = endText === "" ? totalSize - 1 : Number(endText);
  return { start, end };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isValidVideoId(videoId)) {
    return new Response(null, { status: 404 });
  }

  const record = await loadVideoRecord(videoId);
  if (!record) {
    return new Response(null, { status: 404 });
  }

  const totalSize = record.metadata.fileSizeBytes;
  const range = parseRange(request.headers.get("range"), totalSize);

  if (range && (range.start < 0 || range.end >= totalSize || range.start > range.end)) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
  }

  const effectiveRange = range ?? { start: 0, end: totalSize - 1 };
  const stream = await storageProvider.createReadStream(record.storageKey, effectiveRange);

  const headers = new Headers({
    "Content-Type": record.contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(effectiveRange.end - effectiveRange.start + 1),
    "Cache-Control": "private, no-store",
  });

  if (range) {
    headers.set("Content-Range", `bytes ${effectiveRange.start}-${effectiveRange.end}/${totalSize}`);
  }

  return new Response(stream, { status: range ? 206 : 200, headers });
}
