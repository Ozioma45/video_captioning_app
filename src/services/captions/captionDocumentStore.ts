import type { CaptionDocument } from "@/types";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";

/**
 * Persists a `CaptionDocument` as one JSON file — same pattern as
 * `services/videos/videoRecordStore.ts` (no database in V1,
 * ARCHITECTURE.md §11).
 */
function documentKey(captionDocumentId: string): string {
  return `captions/${captionDocumentId}.json`;
}

export async function saveCaptionDocument(document: CaptionDocument): Promise<void> {
  await storageProvider.save(documentKey(document.id), Buffer.from(JSON.stringify(document)));
}

export async function loadCaptionDocument(captionDocumentId: string): Promise<CaptionDocument | null> {
  try {
    const buffer = await storageProvider.read(documentKey(captionDocumentId));
    return JSON.parse(buffer.toString("utf-8")) as CaptionDocument;
  } catch {
    return null;
  }
}
