import type { Readable } from "node:stream";

/**
 * A defensive, cancellation-safe bridge from a Node `Readable` (an
 * `fs.ReadStream`, in practice) to a Web `ReadableStream`, replacing a
 * bare `Readable.toWeb(fs.createReadStream(...))`.
 *
 * Why this exists: `Readable.toWeb()` can throw
 * `TypeError: Invalid state: Controller is already closed` when the
 * consumer cancels (e.g. a `<video>` element aborting an in-flight Range
 * request, which is routine — happens on every seek) at the same moment
 * the underlying fs stream is mid-emit. Because the video route hands the
 * resulting `ReadableStream` straight to `new Response(stream, ...)`,
 * that error fires from inside the runtime's own stream machinery — not
 * from any code this route awaits — so it surfaces as an **uncaught
 * exception that can crash the whole dev server**, not a request-scoped
 * failure. See ARCHITECTURE.md's streaming reliability notes for the
 * reproduction.
 *
 * This wrapper closes that gap:
 * - a `closed` guard makes every `enqueue`/`close`/`error` call on the
 *   controller idempotent — a late event from the Node stream after the
 *   consumer already cancelled is simply dropped, never double-applied;
 * - `cancel()` (consumer disconnected) destroys the underlying fs stream
 *   immediately, releasing its file descriptor, and all listeners are
 *   removed so nothing can fire into a torn-down controller;
 * - a genuine read error is surfaced via `controller.error()` **only**
 *   while the stream is still live; the same error arriving after
 *   cancellation is logged (it's expected — the read lost a race with
 *   the disconnect) rather than thrown;
 * - backpressure is real: the Node stream is paused whenever the web
 *   stream's internal queue is full (`desiredSize <= 0`) and only
 *   resumed from `pull()`, so a slow consumer can't make this buffer an
 *   entire large file in memory (relevant to the "GET .../stream took
 *   57.1 minutes" symptom — the video element was consuming slower than
 *   disk could deliver, with nothing previously pacing the read side to
 *   match).
 */
export function nodeReadableToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  // Deliberately never removes the 'error' listener (see onError): Node's
  // EventEmitter throws if 'error' is emitted with zero listeners, and a
  // destroyed stream can still emit one asynchronously afterward (e.g. the
  // fd's close() itself failing) — removing this listener early would
  // trade the original crash for a different one at a different moment.
  function cleanup() {
    nodeStream.off("data", onData);
    nodeStream.off("end", onEnd);
    nodeStream.off("close", onClose);
  }

  function onData(chunk: Buffer) {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    } catch {
      // The controller was closed by the runtime (e.g. the HTTP response
      // was aborted) in the moment between our `closed` check and this
      // call — treat it exactly like a cancellation instead of letting a
      // synchronous throw here become an unhandled error.
      closed = true;
      cleanup();
      nodeStream.destroy();
      return;
    }
    if (controllerRef.desiredSize !== null && controllerRef.desiredSize <= 0) {
      nodeStream.pause(); // backpressure — resumed from pull()
    }
  }

  function onEnd() {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      // Already closed by the runtime — nothing left to do.
    }
  }

  function onError(error: NodeJS.ErrnoException) {
    cleanup();
    if (closed) {
      // The consumer had already gone away; this read failure is a
      // straightforward consequence of that, not a new problem.
      console.warn("[storage] read error after the stream was already closed/cancelled (expected on disconnect):", error.code ?? error.message);
      return;
    }
    closed = true;
    try {
      controllerRef?.error(error);
    } catch {
      // Already closed by the runtime.
    }
  }

  function onClose() {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      // Already closed by the runtime.
    }
  }

  nodeStream.on("data", onData);
  nodeStream.on("end", onEnd);
  nodeStream.on("error", onError);
  nodeStream.on("close", onClose);
  nodeStream.pause(); // pull-driven; see start()/pull() below

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    pull() {
      if (!closed) nodeStream.resume();
    },
    cancel() {
      closed = true;
      cleanup();
      nodeStream.destroy();
    },
  });
}
