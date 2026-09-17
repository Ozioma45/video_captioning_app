import { describe, expect, it } from "vitest";

import { UnreadableVideoError } from "../errors";
import { parseFfprobeOutput, type FfprobeOutput } from "../parseFfprobeOutput";

const landscapeWithAudio: FfprobeOutput = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "125.400000" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30000/1001" },
    { codec_type: "audio", codec_name: "aac" },
  ],
};

const verticalNoAudio: FfprobeOutput = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "8.000000" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "24/1" }],
};

const audioOnly: FfprobeOutput = {
  format: { format_name: "mp3", duration: "180.000000" },
  streams: [{ codec_type: "audio", codec_name: "mp3" }],
};

describe("parseFfprobeOutput", () => {
  it("maps a landscape video with audio", () => {
    const result = parseFfprobeOutput(landscapeWithAudio);
    expect(result.durationSeconds).toBeCloseTo(125.4);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.frameRate).toBeCloseTo(29.97, 1);
    expect(result.videoCodec).toBe("h264");
    expect(result.hasAudio).toBe(true);
    expect(result.audioCodec).toBe("aac");
    expect(result.containerFormat).toBe("mov,mp4,m4a,3gp,3g2,mj2");
  });

  it("maps a vertical video with no audio track", () => {
    const result = parseFfprobeOutput(verticalNoAudio);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.hasAudio).toBe(false);
    expect(result.audioCodec).toBeNull();
  });

  it("rejects a file with no video stream", () => {
    expect(() => parseFfprobeOutput(audioOnly)).toThrow(UnreadableVideoError);
  });

  it("falls back to a null frame rate for an unparsable r_frame_rate", () => {
    const result = parseFfprobeOutput({
      format: { duration: "1" },
      streams: [{ codec_type: "video", r_frame_rate: "0/0" }],
    });
    expect(result.frameRate).toBeNull();
  });
});
