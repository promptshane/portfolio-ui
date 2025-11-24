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
  experimental: {
    // Ensure native/binary deps are included in traced output for server/app routes
    serverComponentsExternalPackages: [
      "@prisma/client",
      "bcryptjs",
      "@aws-sdk/client-s3",
    ],
    serverSourceMaps: false,
  },
};

export default nextConfig;
