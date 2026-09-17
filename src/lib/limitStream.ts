/**
 * Enforces a byte ceiling on a Web ReadableStream as it's read, so an
 * upload can be rejected mid-stream even if `Content-Length` was absent
 * or understated — the fast header-based check (see app/api/upload) only
 * covers the honest case. Never buffers the stream; each chunk is
 * forwarded immediately unless the running total exceeds the limit.
 */
export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Stream exceeded the maximum of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export function createByteLimitTransformStream(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new PayloadTooLargeError(maxBytes));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
