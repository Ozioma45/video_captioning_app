/**
 * StorageProvider abstraction (PROJECT.md §28, ARCHITECTURE.md §11).
 *
 * Interface only — no implementation in Phase 1. `LocalFilesystemStorage`
 * (rooted at storage/, outside src/) is built in Phase 2 as uploads start
 * needing somewhere to land. Future `SupabaseStorage`/`S3Storage` etc.
 * implement the same interface without touching call sites.
 */

export interface StorageProvider {
  /** Writes a readable stream/buffer to a location keyed by a logical path, returns the stored path/id. */
  save(key: string, data: ReadableStream | Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
