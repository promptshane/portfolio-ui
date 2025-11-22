// src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";

/**
 * Unified NextAuth options used by both the API handler and server components.
 * Session contains: id, username, preferredName, email.
 */
export const authOptions: NextAuthOptions = {
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
        // @ts-expect-error: custom claims
        token.username = (user as any).username;
        // @ts-expect-error: custom claims
        token.preferredName = (user as any).preferredName ?? null;
        token.email = user.email ?? null;
        // @ts-expect-error: custom claims
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
              // @ts-expect-error: custom claims
              token.username = dbUser.username;
              // @ts-expect-error: custom claims
              token.preferredName = dbUser.preferredName ?? null;
              token.email = dbUser.email ?? null;
              // @ts-expect-error: custom claims
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
      // Make these always available to the app
      // @ts-expect-error: extend session user
      session.user = session.user || {};
      // @ts-expect-error: extend session user
      session.user.id = token.sub ?? null;
      // @ts-expect-error: extend session user
      session.user.username = (token as any).username ?? null;
      // @ts-expect-error: extend session user
      session.user.preferredName = (token as any).preferredName ?? null;
      if (session.user) {
        session.user.name =
          // @ts-expect-error: preferredName is a custom claim on session.user
          session.user.preferredName || // preferred if present
          // @ts-expect-error: username is a custom claim on session.user
          session.user.username ||      // fallback to username
          session.user.name || null;
        session.user.email = (token as any).email ?? session.user.email ?? null;
        // @ts-expect-error: colorPalette is a custom claim on session.user
        session.user.colorPalette = (token as any).colorPalette ?? session.user.colorPalette ?? "classic";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
