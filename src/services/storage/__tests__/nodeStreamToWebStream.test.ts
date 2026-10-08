import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { nodeReadableToWebStream } from "../nodeStreamToWebStream";

/**
 * A minimal stand-in for `fs.ReadStream`'s relevant surface
 * (`on`/`off`/`pause`/`resume`/`destroy`, plus 'data'/'end'/'error'/'close'
 * events) — gives these tests full control over event timing and races
 * that would be nearly impossible to force deterministically against a
 * real file. `LocalFilesystemStorage.test.ts` covers the same module
 * against a real `fs.createReadStream`.
 */
class FakeReadable extends EventEmitter {
  paused = false;
  destroyed = false;
  destroyedWithError: Error | undefined;

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  destroy(error?: Error) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyedWithError = error;
    if (error) this.emit("error", error);
    this.emit("close");
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return chunks;
}

describe("nodeReadableToWebStream", () => {
  it("streams data through to completion for a normal read", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const done = readAll(web);
    await Promise.resolve(); // let the initial pull() (-> resume()) run
    fake.emit("data", Buffer.from("hello "));
    fake.emit("data", Buffer.from("world"));
    fake.emit("end");
    const chunks = await done;
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    expect(text).toBe("hello world");
  });

  it("destroys the underlying stream when the consumer cancels, and ignores data emitted after", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const reader = web.getReader();
    await reader.cancel("client went away");

    expect(fake.destroyed).toBe(true);
    // A 'data' event arriving after cancellation must not throw and must not be delivered.
    expect(() => fake.emit("data", Buffer.from("late"))).not.toThrow();
  });

  it("never enqueues/closes twice: 'end' after 'close' (or vice versa) is a no-op, not a crash", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const done = readAll(web);
    await Promise.resolve();
    fake.emit("data", Buffer.from("x"));
    fake.emit("end");
    expect(() => fake.emit("close")).not.toThrow(); // fs streams often emit both
    await expect(done).resolves.toBeDefined();
  });

  it("propagates a genuine read error via the controller while the stream is still live", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const reader = web.getReader();
    const readPromise = reader.read();
    await Promise.resolve();
    const readError = new Error("disk read failed");
    fake.emit("error", readError);
    await expect(readPromise).rejects.toBe(readError);
  });

  it("logs (does not throw) a read error that arrives after the consumer already cancelled — this is the exact race that used to crash the dev server", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const reader = web.getReader();
    await reader.cancel();

    // Simulate the underlying fs stream's own error arriving just after cancellation
    // (e.g. the OS reports a late failure while the fd is being torn down).
    expect(() => fake.emit("error", Object.assign(new Error("late error"), { code: "EBADF" }))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("after the stream was already closed"), expect.anything());
    warn.mockRestore();
  });

  it("applies backpressure: pauses the source once unread data queues up, resumes it once drained (via pull())", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const reader = web.getReader();

    const firstRead = reader.read(); // the stream's initial pull() -> resume()
    await Promise.resolve();
    expect(fake.paused).toBe(false);

    fake.emit("data", Buffer.from("chunk-1"));
    fake.emit("data", Buffer.from("chunk-2")); // queues up while chunk-1 hasn't been read yet
    expect(fake.paused).toBe(true); // backpressure engaged

    await firstRead; // consumes chunk-1; chunk-2 still queued, so no pull() yet
    expect(fake.paused).toBe(true);

    await reader.read(); // drains chunk-2; queue now empty -> pull() runs -> resume()
    expect(fake.paused).toBe(false);
  });

  it("cleans up the data/end/close listeners once closed (but deliberately keeps one 'error' listener — see below)", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const done = readAll(web);
    await Promise.resolve();
    fake.emit("end");
    await done;
    expect(fake.listenerCount("data")).toBe(0);
    expect(fake.listenerCount("end")).toBe(0);
    expect(fake.listenerCount("close")).toBe(0);
  });

  it("removes the data/end/close listeners on cancellation too", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    await web.getReader().cancel();
    expect(fake.listenerCount("data")).toBe(0);
    expect(fake.listenerCount("close")).toBe(0);
  });

  it("never removes the 'error' listener, even after close/cancel — Node throws if 'error' has zero listeners, and a destroyed stream can still emit one asynchronously", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    await web.getReader().cancel();
    expect(fake.listenerCount("error")).toBeGreaterThan(0);
  });

  it("cancelling twice is a safe no-op (destroy is idempotent)", async () => {
    const fake = new FakeReadable();
    const web = nodeReadableToWebStream(fake as never);
    const reader = web.getReader();
    await reader.cancel();
    await expect(reader.cancel()).resolves.toBeUndefined();
    expect(fake.destroyed).toBe(true);
  });
});
