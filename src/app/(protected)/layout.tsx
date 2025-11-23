// src/app/(protected)/layout.tsx
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import React from "react";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const requestUrl = headerList.get("next-url") || "";
  const pathname = new URL(requestUrl, "http://localhost").pathname;

  const session = await getServerSession(authOptions);

  // This layout applies to protected routes. If not authenticated, redirect to login.
  // The /login page is outside this (protected) group, so it won't be caught in a loop.
  if (!session && pathname !== "/login") {
    redirect("/login?callbackUrl=" + encodeURIComponent(requestUrl));
  }

  // If already logged in and somehow lands on /login within the protected group (unlikely but safe)
  if (session && pathname === "/login") {
    redirect("/");
  }

  return <>{children}</>;
}
