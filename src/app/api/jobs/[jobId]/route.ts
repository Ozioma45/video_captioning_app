import { NextResponse, type NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { loadTranscriptionJob } from "@/services/jobs/transcriptionJobStore";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidId(jobId)) {
    return new Response(null, { status: 404 });
  }

  const job = await loadTranscriptionJob(jobId);
  if (!job) {
    return new Response(null, { status: 404 });
  }

  return NextResponse.json(job);
}
