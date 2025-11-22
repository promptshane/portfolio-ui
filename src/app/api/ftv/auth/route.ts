// src/app/api/ftv/auth/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  const password = body?.password ?? "";
  const expected = process.env.FTV_DEV_PASSWORD;

  if (!expected) {
    return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });
  }
  if (!password) {
    return NextResponse.json({ ok: false, error: "Missing password" }, { status: 400 });
  }
  if (password !== expected) {
    // Clear any prior cookie on failure
    cookies().set({
      name: "ftv_dev",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Set dev auth cookie
  cookies().set({
    name: "ftv_dev",
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });

  return NextResponse.json({ ok: true });
}
