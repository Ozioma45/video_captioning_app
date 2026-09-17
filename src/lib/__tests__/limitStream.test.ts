import { describe, expect, it } from "vitest";

import { createByteLimitTransformStream, PayloadTooLargeError } from "../limitStream";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[index]));
      index += 1;
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return chunks;
}

describe("createByteLimitTransformStream", () => {
  it("passes chunks through unchanged when under the limit", async () => {
    const limited = streamOf(["hello", "world"]).pipeThrough(createByteLimitTransformStream(1000));
    const chunks = await drain(limited);
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    expect(text).toBe("helloworld");
  });

  it("errors once the cumulative size exceeds the limit, even without a trustworthy Content-Length", async () => {
    const limited = streamOf(["aaaaa", "bbbbb", "ccccc"]).pipeThrough(createByteLimitTransformStream(8));
    await expect(drain(limited)).rejects.toThrow(PayloadTooLargeError);
  });
});
