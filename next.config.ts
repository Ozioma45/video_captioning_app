import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ffprobe-installer/ffprobe ships a native binary; it must be required
  // at runtime as-is, not statically bundled/analyzed by the build.
  serverExternalPackages: ["@ffprobe-installer/ffprobe"],
};

export default nextConfig;
