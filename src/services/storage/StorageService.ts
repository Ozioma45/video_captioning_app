/**
 * StorageProvider abstraction (PROJECT.md §28, ARCHITECTURE.md §11).
 *
 * `LocalFilesystemStorage` (rooted at storage/, outside src/) is built in
 * Phase 2. Future `SupabaseStorage`/`S3Storage` etc. implement the same
 * interface without touching call sites.
 *
 * Phase 2 correction to the Phase 1 interface: added `createReadStream`.
 * `read()` returning a whole `Buffer` is fine for small JSON sidecars but
 * cannot serve a multi-GB video preview without buffering the entire file
 * in memory, and gives no way to satisfy an HTTP Range request (required
 * for native `<video>` seeking on long files). `createReadStream` reads a
 * byte range without loading the rest of the file — S3/R2/Supabase Storage
 * all support ranged GETs too, so this generalizes to future providers
 * rather than being a local-filesystem-only escape hatch. See
 * ARCHITECTURE.md §11.
 */

export interface StorageProvider {
  /** Writes a readable stream/buffer to a location keyed by a logical path, returns the stored path/id. */
  save(key: string, data: ReadableStream | Buffer): Promise<string>;
  /** Reads an entire value into memory — only for small values (e.g. JSON sidecars), never video bytes. */
  read(key: string): Promise<Buffer>;
  /** Reads a byte range (or the whole object, if omitted) without buffering it all in memory. */
  createReadStream(key: string, range?: { start: number; end: number }): Promise<ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
