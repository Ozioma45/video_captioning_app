import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream as createNodeReadStream, createWriteStream as createNodeWriteStream } from "node:fs";
import path from "node:path";

import type { StorageProvider } from "./StorageService";
import { nodeReadableToWebStream } from "./nodeStreamToWebStream";

const DEFAULT_STORAGE_ROOT = path.resolve(process.cwd(), "storage");

/**
 * Local filesystem implementation of `StorageProvider` (ARCHITECTURE.md
 * §11). Rooted outside `src/` and `public/`, so nothing here is ever
 * reachable via a static file URL — callers only ever get back the
 * logical key, never an absolute path (the one exception is
 * `getAbsolutePath`, used server-side only, to hand a real path to
 * ffprobe).
 *
 * Every key is resolved and checked against the root before touching the
 * filesystem, even though in practice every key passed in by this
 * codebase is built from an internally generated id (never raw user
 * input) — defense in depth against path traversal.
 */
export class LocalFilesystemStorage implements StorageProvider {
  constructor(private readonly root: string = DEFAULT_STORAGE_ROOT) {}

  getAbsolutePath(key: string): string {
    const resolved = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error("Unsafe storage key: resolves outside the storage root");
    }
    return resolved;
  }

  async save(key: string, data: ReadableStream | Buffer): Promise<string> {
    const absolutePath = this.getAbsolutePath(key);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await writeFile(absolutePath, data);
      return key;
    }

    const nodeReadable = Readable.fromWeb(data as unknown as import("node:stream/web").ReadableStream);
    await pipeline(nodeReadable, createNodeWriteStream(absolutePath));
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.getAbsolutePath(key));
  }

  /**
   * Reads a byte range (or the whole file) as a Web `ReadableStream`. Uses
   * `nodeReadableToWebStream` rather than a bare `Readable.toWeb()` — see
   * that module's doc comment for the "Invalid state: Controller is
   * already closed" crash this avoids when a consumer (typically a
   * `<video>` element seeking, which aborts its in-flight Range request)
   * disconnects mid-stream.
   */
  async createReadStream(key: string, range?: { start: number; end: number }): Promise<ReadableStream> {
    const absolutePath = this.getAbsolutePath(key);
    const nodeStream = range
      ? createNodeReadStream(absolutePath, { start: range.start, end: range.end })
      : createNodeReadStream(absolutePath);
    return nodeReadableToWebStream(nodeStream);
  }

  async delete(key: string): Promise<void> {
    await rm(this.getAbsolutePath(key), { recursive: true, force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.getAbsolutePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const storageProvider: StorageProvider & { getAbsolutePath(key: string): string } = new LocalFilesystemStorage();
