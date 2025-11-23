import { PrismaClient } from "@prisma/client";

// Capture at build time (Next.js inlines process.env.* in server code)
const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEXT_PUBLIC_DATABASE_URL ??
  "";

declare global {
  var __prisma: PrismaClient | undefined;
}

const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

if (!globalThis.__prisma) {
  globalThis.__prisma = prisma;
}

export default prisma;
