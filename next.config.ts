import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ffprobe-installer/ffprobe and @ffmpeg-installer/ffmpeg ship native
  // binaries; they must be required at runtime as-is, not statically
  // bundled/analyzed by the build (see ARCHITECTURE.md Phase 2 notes).
  serverExternalPackages: ["@ffprobe-installer/ffprobe", "@ffmpeg-installer/ffmpeg"],
};

export default nextConfig;
