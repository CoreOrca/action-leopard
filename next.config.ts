import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A lockfile above this repo otherwise makes Turbopack treat that directory as the app root.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
