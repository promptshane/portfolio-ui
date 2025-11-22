// src/app/api/profile/social/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // If not logged in, return an "empty" summary so the UI can stay simple.
    if (!session || !session.user) {
      return NextResponse.json(
        {
          following: [],
          followers: [],
          repostCount: 0,
        },
        { status: 200 }
      );
    }

    const rawId = (session.user as any).id;
    const userId =
      typeof rawId === "number"
        ? rawId
        : rawId
        ? parseInt(String(rawId), 10)
        : null;

    if (!userId || Number.isNaN(userId)) {
      return NextResponse.json(
        {
          following: [],
          followers: [],
          repostCount: 0,
        },
        { status: 200 }
      );
    }

    const [followingRows, followerRows, repostCount] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId },
        include: { following: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.follow.findMany({
        where: { followingId: userId },
        include: { follower: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.notesRepost.count({
        where: { userId },
      }),
    ]);

    const following = followingRows.map((row) => ({
      id: row.following.id,
      handle: (row.following.username ?? "").toLowerCase(),
      preferredName: row.following.preferredName,
    }));

    const followers = followerRows.map((row) => ({
      id: row.follower.id,
      handle: (row.follower.username ?? "").toLowerCase(),
      preferredName: row.follower.preferredName,
    }));

    return NextResponse.json(
      {
        following,
        followers,
        repostCount,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/profile/social] error:", err);
    return NextResponse.json(
      { error: "Failed to load profile social summary" },
      { status: 500 }
    );
  }
}
