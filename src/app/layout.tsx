// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const allowedThemes = new Set([
  "default",
  "icy",
  "violet",
  "luxe",
  "blueAmberTeal",
  "crimsonVioletMint",
]);

function normalizeThemeCookie(value?: string | null) {
  if (!value) return "default";
  const trimmed = value.trim();
  const normalized = trimmed === "classic" ? "default" : trimmed;
  return allowedThemes.has(normalized) ? normalized : "default";
}

function paletteToTheme(palette?: string | null) {
  if (!palette) return null;
  const normalized = palette === "classic" ? "default" : palette;
  if (!allowedThemes.has(normalized)) return null;
  return normalized;
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Portfolio",
    template: "%s | Portfolio",
  },
  description: "Portfolio analysis, notes, news, and settings.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieJar = await cookies();
  const cookieTheme = normalizeThemeCookie(
    cookieJar.get("theme")?.value || "default"
  );
  let theme = cookieTheme;
  let session; // Declare outside try-catch

  try {
    session = await getServerSession(authOptions);
    const paletteFromSession = (
      session?.user as { colorPalette?: string } | undefined
    )?.colorPalette;
    const sessionTheme = paletteToTheme(paletteFromSession);
    if (sessionTheme) theme = sessionTheme;

    const userIdRaw = (session?.user as { id?: string | number } | undefined)
      ?.id;
    const userId =
      typeof userIdRaw === "string" ? Number(userIdRaw) : userIdRaw ?? null;
    if (userId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { colorPalette: true },
      });
      const dbTheme = paletteToTheme(dbUser?.colorPalette ?? undefined);
      if (dbTheme) theme = dbTheme;
    }
  } catch {
    // ignore session lookup failures and fall back to cookie
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased theme-${theme}`}
      >
        {children}
      </body>
    </html>
  );
}
