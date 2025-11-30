// src/app/api/news/articles/[id]/highlights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Rect = { x: number; y: number; width: number; height: number };

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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeRects(input: any): Rect[] {
  if (!Array.isArray(input)) return [];
  const out: Rect[] = [];
  for (const r of input) {
    const x = Number(r?.x);
    const y = Number(r?.y);
    const w = Number(r?.width);
    const h = Number(r?.height);
    if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
    if (w <= 0 || h <= 0) continue;
    out.push({
      x: clamp01(round4(x)),
      y: clamp01(round4(y)),
      width: clamp01(round4(w)),
      height: clamp01(round4(h)),
    });
  }
  // Stable order for signature (top-to-bottom, then left-to-right)
  out.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  return out;
}

function signatureForHighlight(page: number, text: string, rects: Rect[]): string {
  const rectSig = rects
    .map((r) => `${r.x.toFixed(4)},${r.y.toFixed(4)},${r.width.toFixed(4)},${r.height.toFixed(4)}`)
    .join(";");
  return `${page}|${normalizeText(text)}|${rectSig}`;
}

function toDto(row: any) {
  let rects: Rect[] = [];
  try {
    const parsed = JSON.parse(row?.rectsJson ?? "[]");
    rects = normalizeRects(parsed);
  } catch {
    rects = [];
  }
  return {
    id: row.id,
    page: row.page,
    text: row.text,
    rects,
    signature: row.signature,
    comment: row.comment ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const articleId = (id || "").trim();
    if (!articleId) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

    const highlights = await prisma.newsHighlight.findMany({
      where: { userId, articleId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      ok: true,
      highlights: highlights.map(toDto),
    });
  } catch (err) {
    console.error("[news highlights GET] error", err);
    return NextResponse.json({ error: "Failed to load highlights" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const articleId = (id || "").trim();
    if (!articleId) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const page = Number(body?.page);
    const rawText = typeof body?.text === "string" ? body.text : "";
    const text = normalizeText(rawText);
    const rects = normalizeRects(body?.rects);
    const intent: "toggle" | "add" | "remove" =
      body?.intent === "add" || body?.intent === "remove" ? body.intent : "toggle";

    if (!Number.isInteger(page) || page <= 0) {
      return NextResponse.json({ error: "page is required" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!rects.length) {
      return NextResponse.json({ error: "rects are required" }, { status: 400 });
    }

    // Ensure article exists before writing a highlight
    const article = await prisma.newsArticle.findUnique({ where: { id: articleId } });
    if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signature = signatureForHighlight(page, text, rects);

    const existing = await prisma.newsHighlight.findUnique({
      where: { userId_articleId_signature: { userId, articleId, signature } },
    });

    if (intent === "remove") {
      if (!existing) {
        return NextResponse.json({ ok: true, action: "noop" });
      }
      await prisma.newsHighlight.delete({ where: { id: existing.id } });
      return NextResponse.json({
        ok: true,
        action: "removed",
        highlightId: existing.id,
      });
    }

    if (existing && intent === "add") {
      return NextResponse.json({
        ok: true,
        action: "exists",
        highlight: toDto(existing),
      });
    }

    if (existing && intent === "toggle") {
      await prisma.newsHighlight.delete({ where: { id: existing.id } });
      return NextResponse.json({
        ok: true,
        action: "removed",
        highlightId: existing.id,
      });
    }

    // Add highlight
    const created = await prisma.newsHighlight.create({
      data: {
        userId,
        articleId,
        page,
        text,
        rectsJson: JSON.stringify(rects),
        signature,
      },
    });

    return NextResponse.json({
      ok: true,
      action: "added",
      highlight: toDto(created),
    });
  } catch (err) {
    console.error("[news highlights POST] error", err);
    return NextResponse.json({ error: "Failed to save highlight" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const articleId = (id || "").trim();
    if (!articleId) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const highlightId = Number(body?.highlightId);
    const comment = typeof body?.comment === "string" ? body.comment.trim() : null;
    if (!Number.isFinite(highlightId)) {
      return NextResponse.json({ error: "highlightId is required" }, { status: 400 });
    }

    const existing = await prisma.newsHighlight.findFirst({
      where: { id: highlightId, userId, articleId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
    }

    const updated = await prisma.newsHighlight.update({
      where: { id: existing.id },
      data: { comment: comment && comment.length ? comment : null },
    });

    return NextResponse.json({ ok: true, highlight: toDto(updated) });
  } catch (err) {
    console.error("[news highlights PATCH] error", err);
    return NextResponse.json({ error: "Failed to update highlight" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const articleId = (id || "").trim();
    if (!articleId) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

    const url = new URL(req.url);
    const idParam = url.searchParams.get("highlightId");
    const body = await req.json().catch(() => ({}));
    const signatureBody = typeof body?.signature === "string" ? body.signature : null;

    const highlightId = idParam ? Number(idParam) : Number(body?.highlightId);

    const where: any = { userId, articleId };
    if (Number.isFinite(highlightId)) where.id = highlightId;
    if (signatureBody) where.signature = signatureBody;

    // Bulk clear if neither id nor signature provided
    if (!("id" in where) && !("signature" in where)) {
      await prisma.newsHighlight.deleteMany({ where: { userId, articleId } });
      return NextResponse.json({ ok: true, cleared: true });
    }

    const existing = await prisma.newsHighlight.findFirst({ where });
    if (!existing) {
      return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
    }

    await prisma.newsHighlight.delete({ where: { id: existing.id } });

    return NextResponse.json({ ok: true, highlightId: existing.id });
  } catch (err) {
    console.error("[news highlights DELETE] error", err);
    return NextResponse.json({ error: "Failed to delete highlight" }, { status: 500 });
  }
}
