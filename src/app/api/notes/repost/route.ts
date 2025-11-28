// src/app/api/notes/repost/route.ts
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

function normalizeTickers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();

  for (const value of input) {
    if (typeof value !== "string") continue;
    const t = value.trim().toUpperCase();
    if (!t) continue;
    out.add(t);
  }

  return Array.from(out);
}

function parseTickersJson(jsonValue: unknown): string[] {
  if (typeof jsonValue !== "string" || !jsonValue.trim()) return [];
  try {
    const parsed = JSON.parse(jsonValue);
    if (!Array.isArray(parsed)) return [];
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const t = v.trim().toUpperCase();
      if (!t) continue;
      out.add(t);
    }
    return Array.from(out);
  } catch {
    return [];
  }
}

/**
 * GET /api/notes/repost?articleId=...
 *
 * Returns the current user's repost (if any) for a given article.
 * If the user is not logged in or no repost exists, returns { repost: null }.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const articleId = (url.searchParams.get("articleId") || "").trim();

    if (!articleId) {
      return NextResponse.json(
        { error: "articleId is required" },
        { status: 400 }
      );
    }

    const userId = await getCurrentUserId();

    // If not logged in, just report no repost instead of erroring.
    if (!userId) {
      return NextResponse.json({ repost: null }, { status: 200 });
    }

    const record = await prisma.notesRepost.findFirst({
      where: {
        userId,
        articleId,
      },
    });

    if (!record) {
      return NextResponse.json({ repost: null }, { status: 200 });
    }

    const tickers = parseTickersJson(record.tickersJson);
    const timestamp = (record.updatedAt ?? record.createdAt).toISOString();

    return NextResponse.json(
      {
        repost: {
          id: record.id,
          articleId: record.articleId,
          comment: record.comment ?? "",
          tickers,
          createdAtISO: timestamp,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/notes/repost] error:", err);
    return NextResponse.json(
      { error: "Failed to load repost" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notes/repost
 *
 * Body:
 *  - articleId: string (required)
 *  - tickers?: string[] (optional; will be normalized to UPPERCASE, deduped)
 *  - comment?: string (optional)
 *
 * Creates or updates a single repost per (userId, articleId).
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const articleId = String(body?.articleId ?? "").trim();
    const commentRaw =
      typeof body?.comment === "string" ? body.comment : "";
    const tickers = normalizeTickers(body?.tickers);

    if (!articleId) {
      return NextResponse.json(
        { error: "articleId is required" },
        { status: 400 }
      );
    }

    // Trim, but always keep this as a non-null string so Prisma is happy.
    const comment = commentRaw.trim();

    // Always store tickersJson as a JSON string, even if it's an empty array.
    const tickersJson = JSON.stringify(tickers);

    // Ensure a single repost per (userId, articleId).
    const existing = await prisma.notesRepost.findFirst({
      where: {
        userId,
        articleId,
      },
      select: { id: true },
    });

    const record = existing
      ? await prisma.notesRepost.update({
          where: { id: existing.id },
          data: {
            comment, // never null
            tickersJson,
          },
        })
      : await prisma.notesRepost.create({
          data: {
            userId,
            articleId,
            comment, // never null
            tickersJson,
          },
        });

    return NextResponse.json(
      {
        repost: {
          id: record.id,
          articleId: record.articleId,
          comment: record.comment ?? "",
          tickers,
          // Use updatedAt so edits update the timestamp we display.
          createdAtISO: record.updatedAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/notes/repost] error:", err);
    return NextResponse.json(
      { error: "Failed to create repost" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    const articleId = String(body?.articleId ?? "").trim();
    if (!articleId) {
      return NextResponse.json({ error: "articleId is required" }, { status: 400 });
    }
    await prisma.notesRepost.deleteMany({
      where: { userId, articleId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/notes/repost] error:", err);
    return NextResponse.json({ error: "Failed to delete repost" }, { status: 500 });
  }
}
