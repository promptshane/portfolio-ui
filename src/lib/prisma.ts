import { PrismaClient } from "@prisma/client";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEXT_PUBLIC_DATABASE_URL ||
  "";

if (!databaseUrl) {
  // Surface a clear runtime error if Amplify fails to inject DATABASE_URL into the SSR lambda.
  // This keeps us from silently using an undefined connection string.
  throw new Error("DATABASE_URL is not set at runtime. Set it in Amplify SSR env vars.");
}

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
