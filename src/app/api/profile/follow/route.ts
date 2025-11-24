// src/app/api/profile/follow/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

async function getCurrentUserId() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return null;

  const rawId = (session.user as any).id;
  const userId =
    typeof rawId === "number"
      ? rawId
      : rawId
      ? parseInt(String(rawId), 10)
      : null;

  if (!userId || Number.isNaN(userId)) return null;
  return userId;
}

/**
 * Follow a user by handle.
 * Body: { "handle": string }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) ?? {};
    const rawHandle = body.handle as string | undefined;
    const handle =
      typeof rawHandle === "string" ? rawHandle.trim() : "";

    if (!handle) {
      return NextResponse.json(
        { error: "Handle must be provided" },
        { status: 400 }
      );
    }

    // Look up the target by username (and optionally email)
    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: handle }, { email: handle }],
      },
      select: {
        id: true,
        username: true,
        email: true,
        preferredName: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (targetUser.id === userId) {
      return NextResponse.json(
        { error: "You cannot follow yourself" },
        { status: 400 }
      );
    }

    const existing = await prisma.follow.findFirst({
      where: {
        followerId: userId,
        followingId: targetUser.id,
      },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: "Already following",
          follow: {
            id: targetUser.id,
            handle: targetUser.username ?? targetUser.email ?? "",
            preferredName: targetUser.preferredName,
          },
        },
        { status: 409 }
      );
    }

    await prisma.follow.create({
      data: {
        followerId: userId,
        followingId: targetUser.id,
      },
    });

    return NextResponse.json(
      {
        follow: {
          id: targetUser.id,
          handle: targetUser.username ?? targetUser.email ?? "",
          preferredName: targetUser.preferredName,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/profile/follow] error:", err);
    return NextResponse.json(
      { error: "Failed to follow user" },
      { status: 500 }
    );
  }
}

/**
 * Unfollow a user.
 * Body: { "targetUserId"?: number, "handle"?: string }
 * (Either ID or handle can be provided.)
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) ?? {};

    let targetUserId: number | null =
      typeof body.targetUserId === "number"
        ? body.targetUserId
        : null;

    if (!targetUserId && typeof body.handle === "string") {
      const handle = body.handle.trim();
      if (handle) {
        const targetUser = await prisma.user.findFirst({
          where: {
            OR: [{ username: handle }, { email: handle }],
          },
          select: { id: true },
        });

        if (!targetUser) {
          return NextResponse.json(
            { error: "Target user not found" },
            { status: 404 }
          );
        }

        targetUserId = targetUser.id;
      }
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "targetUserId or handle must be provided" },
        { status: 400 }
      );
    }

    await prisma.follow.deleteMany({
      where: {
        followerId: userId,
        followingId: targetUserId,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/profile/follow] error:", err);
    return NextResponse.json(
      { error: "Failed to unfollow user" },
      { status: 500 }
    );
  }
}
