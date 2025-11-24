import { PrismaClient } from "@prisma/client";

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEXT_PUBLIC_DATABASE_URL ??
  null;

if (!databaseUrl) {
  console.warn(
    "DATABASE_URL is not set at runtime. Set it in Amplify env vars for SSR."
  );
}

declare global {
  var __prisma: PrismaClient | undefined;
}

const prisma =
  globalThis.__prisma ??
  new PrismaClient();

if (!globalThis.__prisma) {
  globalThis.__prisma = prisma;
}

export default prisma;
