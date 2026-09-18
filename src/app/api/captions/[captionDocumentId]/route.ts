import { NextResponse, type NextRequest } from "next/server";

import { isValidId } from "@/lib/id";
import { loadCaptionDocument } from "@/services/captions/captionDocumentStore";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ captionDocumentId: string }> }) {
  const { captionDocumentId } = await params;
  if (!isValidId(captionDocumentId)) {
    return new Response(null, { status: 404 });
  }

  const document = await loadCaptionDocument(captionDocumentId);
  if (!document) {
    return new Response(null, { status: 404 });
  }

  return NextResponse.json(document);
}
