import { describe, expect, it } from "vitest";

import { parseWavFormat, sliceWavBuffer, UnsupportedWavFormatError, wavDurationSeconds } from "../wavSlicing";

/** Builds a minimal, valid 16kHz/mono/16-bit PCM WAV with `seconds` of a counting-sample pattern (so slices are verifiable). */
function makeWav(seconds: number, sampleRate = 16000): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(i % 32767, i * 2);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A WAV with a LIST/INFO chunk between fmt and data — real ffmpeg output shape (see the module's doc comment). */
function makeWavWithListChunk(seconds: number): Buffer {
  const plain = makeWav(seconds);
  const fmtEnd = 12 + 8 + 16; // RIFF header(12) + "fmt "+size(8) + fmt payload(16)
  const listChunk = Buffer.concat([
    Buffer.from("LIST", "ascii"),
    (() => {
      const n = Buffer.alloc(4);
      n.writeUInt32LE(10, 0);
      return n;
    })(),
    Buffer.from("INFOISFT\0\0", "ascii"), // 10 bytes payload
  ]);
  const withList = Buffer.concat([plain.subarray(0, fmtEnd), listChunk, plain.subarray(fmtEnd)]);
  withList.writeUInt32LE(withList.length - 8, 4); // fix RIFF size
  return withList;
}

describe("parseWavFormat", () => {
  it("reads a plain 16kHz mono 16-bit PCM WAV", () => {
    const format = parseWavFormat(makeWav(2));
    expect(format).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  });

  it("reads a WAV with a LIST/INFO metadata chunk between fmt and data (real ffmpeg output shape)", () => {
    const format = parseWavFormat(makeWavWithListChunk(2));
    expect(format).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(format.dataLength).toBe(2 * 16000 * 2);
  });

  it("rejects a non-WAV file", () => {
    expect(() => parseWavFormat(Buffer.from("not a wav file at all"))).toThrow(UnsupportedWavFormatError);
  });

  it("rejects a WAV missing a data chunk entirely", () => {
    const noData = makeWav(1).subarray(0, 36); // RIFF header + fmt chunk, no "data" chunk id at all
    expect(() => parseWavFormat(noData)).toThrow(UnsupportedWavFormatError);
  });

  it("rejects non-PCM / non-16-bit formats", () => {
    const nonPcm = makeWav(1);
    nonPcm.writeUInt16LE(3, 20); // IEEE float, not PCM
    expect(() => parseWavFormat(nonPcm)).toThrow(/PCM/);

    const bit8 = makeWav(1);
    bit8.writeUInt16LE(8, 34);
    expect(() => parseWavFormat(bit8)).toThrow(/expected 16/);
  });
});

describe("wavDurationSeconds", () => {
  it("matches the duration the WAV was built with", () => {
    expect(wavDurationSeconds(makeWav(5))).toBeCloseTo(5, 5);
    expect(wavDurationSeconds(makeWavWithListChunk(3.5))).toBeCloseTo(3.5, 5);
  });
});

describe("sliceWavBuffer", () => {
  it("produces a self-contained WAV of exactly the requested duration", () => {
    const full = makeWav(10);
    const slice = sliceWavBuffer(full, 2, 5);
    expect(wavDurationSeconds(slice)).toBeCloseTo(3, 5);
    expect(parseWavFormat(slice)).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  });

  it("slices byte-exact sample data (no resampling, no corruption)", () => {
    const full = makeWav(10);
    const slice = sliceWavBuffer(full, 2, 3); // 1 second = 16000 samples starting at sample 32000
    const format = parseWavFormat(slice);
    const pcm = slice.subarray(format.dataOffset, format.dataOffset + format.dataLength);
    for (let i = 0; i < 16000; i++) {
      expect(pcm.readInt16LE(i * 2)).toBe((32000 + i) % 32767);
    }
  });

  it("omitted end means to the end of the file", () => {
    const full = makeWav(10);
    expect(wavDurationSeconds(sliceWavBuffer(full, 8))).toBeCloseTo(2, 5);
  });

  it("clamps out-of-range bounds instead of throwing", () => {
    const full = makeWav(5);
    expect(wavDurationSeconds(sliceWavBuffer(full, -3, 2))).toBeCloseTo(2, 5);
    expect(wavDurationSeconds(sliceWavBuffer(full, 3, 999))).toBeCloseTo(2, 5);
    expect(wavDurationSeconds(sliceWavBuffer(full, 10, 20))).toBeCloseTo(0, 5); // fully past the end
  });

  it("consecutive non-overlapping slices reconstruct the whole file with no gap or overlap", () => {
    const full = makeWav(9);
    const a = sliceWavBuffer(full, 0, 3);
    const b = sliceWavBuffer(full, 3, 6);
    const c = sliceWavBuffer(full, 6, 9);
    const reconstructed = Buffer.concat([
      a.subarray(parseWavFormat(a).dataOffset),
      b.subarray(parseWavFormat(b).dataOffset),
      c.subarray(parseWavFormat(c).dataOffset),
    ]);
    const original = full.subarray(parseWavFormat(full).dataOffset);
    expect(reconstructed.equals(original)).toBe(true);
  });

  it("handles a WAV with a LIST chunk the same way as a plain one", () => {
    const withList = makeWavWithListChunk(10);
    const plain = makeWav(10);
    expect(sliceWavBuffer(withList, 2, 5).equals(sliceWavBuffer(plain, 2, 5))).toBe(true);
  });
});
