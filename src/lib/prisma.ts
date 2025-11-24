import { PrismaClient } from "@prisma/client";
import { readEnv } from "./serverEnv";

const databaseUrl =
  readEnv("DATABASE_URL") ??
  readEnv("POSTGRES_URL") ??
  readEnv("NEXT_PUBLIC_DATABASE_URL") ??
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
