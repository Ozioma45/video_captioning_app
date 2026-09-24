import { NextResponse, type NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { loadExportJob } from "@/services/export/exportJobStore";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  if (!isValidId(exportId)) {
    return new Response(null, { status: 404 });
  }

  const job = await loadExportJob(exportId);
  if (!job) {
    return new Response(null, { status: 404 });
  }

  // Public view: technical `detail` stays server-side.
  const error = job.error ? { message: job.error.message, projectSafe: job.error.projectSafe } : null;
  return NextResponse.json(
    { ...job, error },
    { headers: { "Cache-Control": "no-store" } },
  );
}
