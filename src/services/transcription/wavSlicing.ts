/**
 * Minimal, pure RIFF/WAVE reader and time-range slicer for the one shape
 * this project ever produces: PCM, mono, 16-bit, 16 kHz — exactly what
 * `FfmpegVideoProcessor.extractAudio` writes (`-ac 1 -ar 16000 -f wav`),
 * which is whisper.cpp's required input format. Used to split a long
 * extracted audio file into independent chunks for long-form
 * transcription (see `WhisperCppTranscriptionProvider`'s chunking —
 * ARCHITECTURE.md's Whisper reliability notes) without spawning an extra
 * ffmpeg process per chunk.
 *
 * Real ffmpeg output is not a bare 44-byte header + data: it writes a
 * `LIST`/`INFO` metadata chunk between `fmt ` and `data` (verified
 * against the ffmpeg build this project uses), so this walks RIFF chunks
 * by id/size rather than assuming a fixed offset.
 */

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Byte offset of the `data` chunk's payload within the file. */
  dataOffset: number;
  /** Length, in bytes, of the `data` chunk's payload. */
  dataLength: number;
}

export class UnsupportedWavFormatError extends Error {
  constructor(reason: string) {
    super(`Unsupported or malformed WAV file: ${reason}`);
    this.name = "UnsupportedWavFormatError";
  }
}

/** Parses a WAV file's `fmt `/`data` chunks. Throws `UnsupportedWavFormatError` for anything not RIFF/WAVE/PCM. */
export function parseWavFormat(buffer: Buffer): WavFormat {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new UnsupportedWavFormatError("not a RIFF/WAVE file");
  }

  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number; audioFormat: number } | null = null;
  let data: { offset: number; length: number } | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt ") {
      if (chunkDataStart + 16 > buffer.length) throw new UnsupportedWavFormatError("truncated fmt chunk");
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataStart),
        channels: buffer.readUInt16LE(chunkDataStart + 2),
        sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
      };
    } else if (chunkId === "data") {
      // A real file's data chunk can be shorter than its declared size if
      // the writer was interrupted; clamp rather than read past the buffer.
      data = { offset: chunkDataStart, length: Math.min(chunkSize, buffer.length - chunkDataStart) };
    }

    // RIFF chunks are word-aligned: a chunk with odd size has one pad byte.
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) throw new UnsupportedWavFormatError("missing fmt chunk");
  if (!data) throw new UnsupportedWavFormatError("missing data chunk");
  if (fmt.audioFormat !== 1) throw new UnsupportedWavFormatError(`audio format ${fmt.audioFormat} is not PCM`);
  if (fmt.bitsPerSample !== 16) throw new UnsupportedWavFormatError(`${fmt.bitsPerSample}-bit samples are not supported (expected 16)`);

  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, dataOffset: data.offset, dataLength: data.length };
}

function buildWavHeader(format: WavFormat, dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = format.sampleRate * format.channels * (format.bitsPerSample / 8);
  const blockAlign = format.channels * (format.bitsPerSample / 8);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * Returns a new, self-contained WAV buffer (minimal 44-byte header, no
 * `LIST`/metadata chunks) containing the audio in `[startSeconds,
 * endSeconds)`. Both bounds are clamped to the file's actual duration;
 * `endSeconds` may be omitted for "to the end." Byte-exact sample
 * alignment is preserved (never splits a sample frame).
 */
export function sliceWavBuffer(buffer: Buffer, startSeconds: number, endSeconds?: number): Buffer {
  const format = parseWavFormat(buffer);
  const bytesPerFrame = format.channels * (format.bitsPerSample / 8);
  const totalFrames = Math.floor(format.dataLength / bytesPerFrame);
  const totalSeconds = totalFrames / format.sampleRate;

  const clampedStart = Math.max(0, Math.min(startSeconds, totalSeconds));
  const clampedEnd = Math.max(clampedStart, Math.min(endSeconds ?? totalSeconds, totalSeconds));

  const startFrame = Math.round(clampedStart * format.sampleRate);
  const endFrame = Math.min(totalFrames, Math.round(clampedEnd * format.sampleRate));

  const sliceStart = format.dataOffset + startFrame * bytesPerFrame;
  const sliceEnd = format.dataOffset + endFrame * bytesPerFrame;
  const pcm = buffer.subarray(sliceStart, Math.max(sliceStart, sliceEnd));

  return Buffer.concat([buildWavHeader(format, pcm.length), pcm]);
}

/** The duration, in seconds, of a WAV buffer's audio data. */
export function wavDurationSeconds(buffer: Buffer): number {
  const format = parseWavFormat(buffer);
  const bytesPerFrame = format.channels * (format.bitsPerSample / 8);
  return format.dataLength / bytesPerFrame / format.sampleRate;
}
