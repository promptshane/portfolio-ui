import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": [
      "./data/**",
      "./public/ftv/**",
      "./prisma/**",
      "./sqlite/**",
    ],
  },
  experimental: {
    serverSourceMaps: false,
  },
};

export default nextConfig;
