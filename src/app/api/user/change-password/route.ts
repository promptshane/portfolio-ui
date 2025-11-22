import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { currentPassword = "", newPassword = "" } = await req.json();
    if (newPassword.trim().length < 8) {
      return NextResponse.json(
        { error: "newPassword must be at least 8 characters." },
        { status: 400 }
      );
    }

    const userId = (session.user as any).id as number | string | undefined;
    const email = (session.user as any).email as string | undefined;

    const user =
      (userId &&
        (await prisma.user.findUnique({
          where: typeof userId === "number" ? { id: userId } : { id: Number(userId) },
          select: { id: true, email: true, hashedPassword: true, password: true },
        }))) ||
      (email &&
        (await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, hashedPassword: true, password: true },
        })));

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existingHash =
      ((user as any).hashedPassword as string | null | undefined) ??
      ((user as any).password as string | null | undefined) ??
      null;
    if (existingHash) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "currentPassword is required." },
          { status: 400 }
        );
      }
      const ok = await bcrypt.compare(currentPassword, existingHash);
      if (!ok) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 400 }
        );
      }
    }

    const nextHash = await bcrypt.hash(newPassword, 12);
    const data: Record<string, string> = {};
    if ("hashedPassword" in user) data.hashedPassword = nextHash;
    if ("password" in user) data.password = nextHash;
    if (!Object.keys(data).length) {
      return NextResponse.json(
        { error: "User schema missing password fields." },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: userId
        ? typeof userId === "number"
          ? { id: userId }
          : { id: Number(userId) }
        : { email: email! },
      data,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Internal error", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
