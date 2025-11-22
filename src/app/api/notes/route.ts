// src/app/api/notes/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNotesFeedForUser } from "@/server/notes";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // If not logged in, just return an empty feed for now.
    if (!session || !session.user) {
      return NextResponse.json([], { status: 200 });
    }

    const rawId = (session.user as any).id;
    const userId =
      typeof rawId === "number" ? rawId : rawId ? parseInt(String(rawId), 10) : null;

    const feed = await getNotesFeedForUser(userId ?? null);

    return NextResponse.json(feed, { status: 200 });
  } catch (err) {
    console.error("[GET /api/notes] error:", err);
    return NextResponse.json(
      { error: "Failed to load notes feed" },
      { status: 500 }
    );
  }
}
