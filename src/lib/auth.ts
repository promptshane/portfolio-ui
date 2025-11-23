// src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
if (!authSecret) {
  throw new Error("NEXTAUTH_SECRET (or AUTH_SECRET) must be set in production.");
}

/**
 * Unified NextAuth options used by both the API handler and server components.
 * Session contains: id, username, preferredName, email.
 */
export const authOptions: NextAuthOptions = {
  secret: authSecret,
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username || "").trim();
        const password = String(credentials?.password || "");

        if (!username || !password) return null;

        // Allow sign-in by username OR email (common UX nicety)
        const user = await prisma.user.findFirst({
          where: {
            OR: [{ username }, { email: username }],
          },
          select: {
            id: true,
            username: true,
            preferredName: true,
            email: true,
            password: true,
            hashedPassword: true,
            colorPalette: true,
          },
        });
        const storedHash = user?.hashedPassword ?? user?.password;
        if (!user || !storedHash) return null;

        const ok = await compare(password, storedHash);
        if (!ok) return null;

        return {
          id: String(user.id),
          username: user.username,
          preferredName: user.preferredName ?? null,
          email: user.email ?? null,
          colorPalette: user.colorPalette ?? "classic",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, copy fields from user object
      if (user) {
        token.sub = user.id as string;
        token.username = (user as any).username;
        token.preferredName = (user as any).preferredName ?? null;
        token.email = user.email ?? null;
        token.colorPalette = (user as any).colorPalette ?? "classic";
      } else {
        // Keep claims current if user changed preferredName/username
        if (token.sub) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: Number(token.sub) },
              select: { username: true, preferredName: true, email: true, colorPalette: true },
            });
            if (dbUser) {
              token.username = dbUser.username;
              token.preferredName = dbUser.preferredName ?? null;
              token.email = dbUser.email ?? null;
              token.colorPalette = dbUser.colorPalette ?? "classic";
            }
          } catch {
            // ignore
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      const user = (session.user || {}) as Record<string, unknown>;
      user.id = token.sub ?? null;
      user.username = (token as any).username ?? null;
      user.preferredName = (token as any).preferredName ?? null;
      user.name =
        user.preferredName ||
        user.username ||
        (session.user as any)?.name ||
        null;
      user.email = (token as any).email ?? (session.user as any)?.email ?? null;
      user.colorPalette =
        (token as any).colorPalette ?? (session.user as any)?.colorPalette ?? "classic";
      session.user = user as any;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
