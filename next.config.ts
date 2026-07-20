import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo sits below another package-lock.json; pinning the root keeps
  // Turbopack's resolver and file watcher scoped to this application.
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: ['127.0.0.1']
};

export default nextConfig;
