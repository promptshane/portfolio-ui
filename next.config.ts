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
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
    ],
  },
  // Ensure native/binary deps are included in traced output for server/app routes
  serverExternalPackages: ["@prisma/client", "bcryptjs", "@aws-sdk/client-s3"],
  experimental: {
    serverSourceMaps: false,
  },
};

export default nextConfig;
