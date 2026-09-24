import { NextResponse, type NextRequest } from "next/server";

import { validateExportRequest } from "@/domain/export-engine/exportRequest";
import { createExportJob, hasActiveExport, registerActiveExport, saveExportJob } from "@/services/export/exportJobStore";
import { runExportJob } from "@/services/export/runExportJob";
import { loadVideoRecord } from "@/services/videos/videoRecordStore";

// Starts a long-running FFmpeg job — Node runtime only.
export const runtime = "nodejs";

/** A 2-hour video's captions are a few MB of JSON; anything far beyond that is refused. */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "body_too_large", "The export request is too large.");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return errorResponse(400, "invalid_body", "Expected a JSON body.");
  }
  if (text.length > MAX_BODY_BYTES) {
    return errorResponse(413, "body_too_large", "The export request is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse(400, "invalid_body", "Expected a JSON body.");
  }

  // The client sends the current (edited) captions and style; every field is validated and copied.
  const validated = validateExportRequest(body);
  if (!validated.ok) {
    const status = validated.issue.code === "invalid_body" ? 400 : 422;
    return errorResponse(status, validated.issue.code, validated.issue.message);
  }
  const { value } = validated;

  const record = await loadVideoRecord(value.videoId);
  if (!record) {
    return errorResponse(404, "video_not_found", "This video could not be found.");
  }

  // One render at a time in V1: FFmpeg re-encoding saturates the machine (no queue by design).
  if (hasActiveExport()) {
    return errorResponse(409, "export_in_progress", "Another export is already running. Please wait for it to finish.");
  }

  const job = createExportJob(value.videoId);
  await saveExportJob(job);
  registerActiveExport(job.id);

  // Fire-and-forget; the job record carries status, progress and errors.
  void runExportJob(job.id, value);

  return NextResponse.json({ exportId: job.id }, { status: 202 });
}
