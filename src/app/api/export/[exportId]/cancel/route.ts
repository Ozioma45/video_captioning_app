import { NextResponse, type NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { loadExportJob, requestExportCancel, saveExportJob, updateExportJob } from "@/services/export/exportJobStore";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  if (!isValidId(exportId)) {
    return new Response(null, { status: 404 });
  }

  const job = await loadExportJob(exportId);
  if (!job) {
    return new Response(null, { status: 404 });
  }

  if (job.status !== "queued" && job.status !== "processing") {
    return NextResponse.json(
      { error: { code: "not_cancellable", message: `This export is already ${job.status}.` } },
      { status: 409 },
    );
  }

  // Normal case: the job is running in this process. Kill FFmpeg; the runner
  // records `cancelled` and removes the partial output once the process is gone.
  if (requestExportCancel(exportId)) {
    return NextResponse.json({ status: "cancelling" }, { status: 202 });
  }

  // The record says running but nothing in this process owns it (e.g. the
  // server restarted mid-render). Nothing to kill; just settle the record.
  await saveExportJob(updateExportJob(job, { status: "cancelled", progressPercent: null, finishedAt: new Date().toISOString() }));
  return NextResponse.json({ status: "cancelled" }, { status: 200 });
}
