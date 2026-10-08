import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalFilesystemStorage } from "../LocalFilesystemStorage";

let root: string;
let storage: LocalFilesystemStorage;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "caption-studio-storage-test-"));
  storage = new LocalFilesystemStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readWebStreamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

describe("LocalFilesystemStorage", () => {
  it("writes and reads back a Buffer value", async () => {
    await storage.save("uploads/abc/record.json", Buffer.from('{"ok":true}'));
    const read = await storage.read("uploads/abc/record.json");
    expect(read.toString("utf-8")).toBe('{"ok":true}');
    expect(await storage.exists("uploads/abc/record.json")).toBe(true);
  });

  it("reports non-existent keys as not existing", async () => {
    expect(await storage.exists("uploads/does-not-exist/record.json")).toBe(false);
  });

  it("deletes a whole video directory in one call", async () => {
    await storage.save("uploads/vid1/source.bin", Buffer.from("bytes"));
    await storage.save("uploads/vid1/record.json", Buffer.from("{}"));
    await storage.delete("uploads/vid1");
    expect(await storage.exists("uploads/vid1/source.bin")).toBe(false);
    expect(await storage.exists("uploads/vid1/record.json")).toBe(false);
  });

  it("reads a byte range without reading the whole file", async () => {
    await storage.save("uploads/vid2/source.bin", Buffer.from("0123456789"));
    const stream = await storage.createReadStream("uploads/vid2/source.bin", { start: 2, end: 5 });
    const text = await readWebStreamToString(stream);
    expect(text).toBe("2345");
  });

  it("rejects a key that resolves outside the storage root", () => {
    expect(() => storage.getAbsolutePath("../../etc/passwd")).toThrow(/outside the storage root/);
  });

  it("rejects an absolute-looking key that still escapes the root", () => {
    expect(() => storage.getAbsolutePath("uploads/../../secret")).toThrow(/outside the storage root/);
  });

  describe("createReadStream — cancellation safety (the video-stream reliability fix)", () => {
    /**
     * These exercise the real thing (`fs.createReadStream` under the hood,
     * on a real file) rather than the fake-stream unit tests in
     * `nodeStreamToWebStream.test.ts`, so a real file descriptor is really
     * released — the concrete, checkable proxy for that on Windows is that
     * the file can be renamed/deleted immediately afterward without an
     * EBUSY/EPERM lock error.
     */

    it("releases the file descriptor when the consumer cancels mid-read (no lingering lock)", async () => {
      const key = "uploads/cancel-test/source.bin";
      await storage.save(key, Buffer.alloc(5 * 1024 * 1024, 7)); // large enough to still be mid-flight when cancelled
      const stream = await storage.createReadStream(key);
      const reader = stream.getReader();
      await reader.read();
      await reader.cancel("simulated client disconnect");

      // If the fd were still open, this would fail with EBUSY/EPERM on Windows.
      const absolutePath = storage.getAbsolutePath(key);
      await expect(rename(absolutePath, `${absolutePath}.renamed`)).resolves.toBeUndefined();
    });

    it("many concurrent aborted range reads neither crash nor leak (regression for the reported dev-server crash)", async () => {
      const key = "uploads/many-cancel-test/source.bin";
      const size = 2 * 1024 * 1024;
      await storage.save(key, Buffer.alloc(size, 9));
      const absolutePath = storage.getAbsolutePath(key);

      const errorListener = vi.fn();
      process.on("uncaughtException", errorListener);
      try {
        await Promise.all(
          Array.from({ length: 30 }, async (_, i) => {
            const start = (i * 50000) % (size - 100000);
            const stream = await storage.createReadStream(key, { start, end: size - 1 });
            const reader = stream.getReader();
            await reader.read();
            await reader.read();
            await reader.cancel();
          }),
        );
      } finally {
        process.off("uncaughtException", errorListener);
      }

      expect(errorListener).not.toHaveBeenCalled();
      // Every read was cancelled, so every fd should be released.
      await expect(rename(absolutePath, `${absolutePath}.renamed`)).resolves.toBeUndefined();
    });

    it("a real full read (no cancellation) still returns exactly the right bytes", async () => {
      const key = "uploads/full-read-test/source.bin";
      const original = Buffer.from("the quick brown fox jumps over the lazy dog, ".repeat(1000));
      await storage.save(key, original);
      const stream = await storage.createReadStream(key);
      const text = await readWebStreamToString(stream);
      expect(text).toBe(original.toString("utf-8"));
    });

    it("a genuinely truncated file (read races a shrink) errors the stream rather than hanging or crashing", async () => {
      const key = "uploads/truncate-test/source.bin";
      const absolutePath = path.join(root, key);
      await storage.save(key, Buffer.alloc(1024 * 1024, 1));
      // Ask for a range past what we're about to leave in the file.
      const stream = await storage.createReadStream(key, { start: 900_000, end: 1024 * 1024 - 1 });
      await writeFile(absolutePath, Buffer.alloc(10)); // truncate out from under the open read
      const reader = stream.getReader();
      // Either it errors, or (depending on OS-level fd semantics) it simply
      // returns whatever remained — either way, it must settle rather than
      // hang, and must not throw an uncaught exception.
      await expect(
        (async () => {
          try {
            for (;;) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch {
            // an error here is an acceptable, expected outcome for this race
          }
        })(),
      ).resolves.toBeUndefined();
    });
  });
});
