import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";

/**
 * POST /api/auth/register
 * Body:
 *  - username (required)
 *  - preferredName (optional)
 *  - phone (optional; digits only are fine)
 *  - password (required, >= 6)
 *  - confirm  (required; must match password)
 *
 * This handler adapts to your current Prisma schema:
 * - If User.phone does not exist, we omit it automatically.
 * - If User.email exists and is required, we synthesize `${username}@local.invalid`.
 *   If it's optional, we store null.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const rawUsername = String(body?.username || "").trim();
    const username = rawUsername.toLowerCase(); // normalize to lowercase
    const preferredName = String(body?.preferredName || "").trim();
    const phoneDigits = String(body?.phone || "").replace(/\D/g, ""); // store digits only
    const password = String(body?.password || "");
    const confirm = String(body?.confirm || "");

    if (!rawUsername || !password || !confirm) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
    if (password !== confirm) {
      return NextResponse.json(
        { error: "Passwords do not match" },
        { status: 400 }
      );
    }

    // Prevent duplicate username (case-insensitive, since we store lowercase)
    const exists = await prisma.user.findFirst({
      where: { username },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 409 }
      );
    }

    // Introspect the generated Prisma client to see which fields exist/required
    const userModel = (Prisma as any)?.dmmf?.datamodel?.models?.find(
      (m: any) => m.name === "User"
    );
    const hasPhone: boolean = !!userModel?.fields?.some(
      (f: any) => f.name === "phone"
    );
    const emailField: any = userModel?.fields?.find(
      (f: any) => f.name === "email"
    );

    const hashed = await hash(password, 12);

    const data: any = {
      username, // already lowercased
      preferredName: preferredName || username,
      password: hashed,
      hashedPassword: hashed,
    };

    if (emailField) {
      // If email is required but we don't collect it, synthesize a harmless local value
      data.email = emailField.isRequired
        ? `${username}@local.invalid`
        : null;
    }
    if (hasPhone && phoneDigits) {
      data.phone = phoneDigits;
    }

    const user = await prisma.user.create({
      data,
      select: { id: true, username: true, preferredName: true },
    });

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    // Surface a concise error to the client for easier debugging
    const msg =
      typeof e?.message === "string"
        ? e.message.slice(0, 200)
        : "Registration failed";
    return NextResponse.json(
      { error: msg || "Registration failed" },
      { status: 500 }
    );
  }
}
