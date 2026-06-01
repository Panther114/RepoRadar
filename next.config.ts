import type { NextConfig } from "next";

const exfatMode = process.env.REPORADAR_EXFAT_MODE === "true";

const nextConfig: NextConfig = {
  // Disable server-side image optimisation — avoids loading the `sharp` native
  // binary which is not pre-built for this win32-x64 environment.
  images: { unoptimized: true },
  // Transformers.js / onnxruntime ship native + wasm assets that must not be
  // bundled by webpack — keep them external to the server runtime.
  serverExternalPackages: ["@xenova/transformers", "onnxruntime-node", "sharp"],
  webpack: (config) => {
    if (exfatMode) {
      // exFAT has no symlink support. These workarounds keep dev usable on
      // removable exFAT drives, but they slow and destabilize normal NTFS
      // checkouts, so they are opt-in via REPORADAR_EXFAT_MODE=true.
      config.resolve.symlinks = false;
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
