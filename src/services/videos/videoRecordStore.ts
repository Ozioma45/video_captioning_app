import type { VideoMetadata } from "@/types";
import { storageProvider } from "@/services/storage/LocalFilesystemStorage";

/**
 * Server-only association between a videoId and where/what it actually
 * is on disk. Built on top of `StorageProvider` (a generic key/value blob
 * store) rather than extending that interface — the "video record"
 * concept is application-level, not something every future storage
 * backend needs to know about. No database in V1 (ARCHITECTURE.md §11):
 * this is one small JSON file per video.
 */
export interface StoredVideoRecord {
  videoId: string;
  storageKey: string;
  contentType: string;
  originalFilename: string;
  metadata: VideoMetadata;
  createdAt: string;
}

function recordKey(videoId: string): string {
  return `uploads/${videoId}/record.json`;
}

export function videoDirectoryKey(videoId: string): string {
  return `uploads/${videoId}`;
}

export function videoSourceKey(videoId: string): string {
  return `uploads/${videoId}/source.bin`;
}

export async function saveVideoRecord(record: StoredVideoRecord): Promise<void> {
  await storageProvider.save(recordKey(record.videoId), Buffer.from(JSON.stringify(record)));
}

export async function loadVideoRecord(videoId: string): Promise<StoredVideoRecord | null> {
  try {
    const buffer = await storageProvider.read(recordKey(videoId));
    return JSON.parse(buffer.toString("utf-8")) as StoredVideoRecord;
  } catch {
    return null;
  }
}

export async function deleteVideo(videoId: string): Promise<void> {
  await storageProvider.delete(videoDirectoryKey(videoId));
}
