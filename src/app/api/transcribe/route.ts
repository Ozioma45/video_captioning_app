import { NextResponse, type NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { loadVideoRecord } from "@/services/videos/videoRecordStore";
import { createTranscriptionJob, saveTranscriptionJob } from "@/services/jobs/transcriptionJobStore";
import { runTranscriptionJob } from "@/services/jobs/runTranscriptionJob";

// Kicks off a long-running background job (child processes, filesystem)
// and returns immediately — cannot run on the edge runtime.
export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_body", "Expected a JSON body with a videoId.");
  }

  const videoId = (body as { videoId?: unknown } | null)?.videoId;
  if (typeof videoId !== "string" || !isValidId(videoId)) {
    return errorResponse(400, "invalid_video_id", "A valid videoId is required.");
  }

  const record = await loadVideoRecord(videoId);
  if (!record) {
    return errorResponse(404, "video_not_found", "This video could not be found.");
  }

  if (!record.metadata.hasAudio) {
    return errorResponse(422, "no_audio", "This video has no audio track to transcribe.");
  }

  const job = createTranscriptionJob(videoId);
  await saveTranscriptionJob(job);

  // Fire-and-forget: everything past this point is reported through the
  // job record itself (ARCHITECTURE.md §5 — nothing heavy runs
  // synchronously in a request/response cycle). Errors inside the job are
  // caught and persisted by runTranscriptionJob; this call is not awaited.
  void runTranscriptionJob(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
