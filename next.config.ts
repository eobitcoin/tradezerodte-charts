import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native-binary deps that must NOT be bundled by Next.js's webpack.
  // These have platform-specific native binaries; bundling them breaks
  // both build (cross-platform native module resolution) and runtime
  // (the bundled wrapper can't dlopen the .node binary). Marking them
  // server-external means Next.js leaves the `require`/`import` as a
  // bare reference at runtime, where the native module loads from
  // node_modules normally.
  serverExternalPackages: [
    // YouTube thumbnail generator (lib/thumbnail-generator.ts).
    "@napi-rs/canvas",
    // Video mux / outro / thumbnails all spawn ffmpeg via the
    // ffmpeg-static path. ffmpeg-static's postinstall downloads the
    // binary at install time; bundling its tiny JS wrapper sometimes
    // breaks path resolution to the binary.
    "ffmpeg-static",
  ],
};

export default nextConfig;
