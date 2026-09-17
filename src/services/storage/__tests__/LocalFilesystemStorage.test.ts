import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
