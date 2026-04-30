import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname),
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
