import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Item = z.object({
  sym: z.string(),
  shares: z.number(),
  avgCost: z.number().optional(),
});
const Body = z.object({
  items: z.array(Item).optional(),
  ownerId: z.number().optional(),
});

function getSessionUserId(session: unknown): number | null {
  const raw = (session as { user?: { id?: number | string | null } } | null)?.user?.id;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function ensureViewAccess(requestorId: number, targetId: number) {
  if (requestorId === targetId) return true;
  const link = await prisma.overseerLink.findUnique({
    where: { overseerId_targetId: { overseerId: requestorId, targetId } },
    select: { id: true },
  });
  return !!link;
}

// GET: return holdings for target (self or overseen)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getSessionUserId(session);
  if (!uid) return NextResponse.json({ items: [] }, { status: 200 });

  const searchParams = req.nextUrl.searchParams;
  const ownerIdParam = searchParams.get("ownerId");
  let targetId = uid;
  if (ownerIdParam) {
    const parsed = Number(ownerIdParam);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Invalid ownerId" }, { status: 400 });
    }
    targetId = parsed;
    const allowed = await ensureViewAccess(uid, targetId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const rows = await prisma.holding.findMany({
    where: { userId: targetId },
    orderBy: { sym: "asc" },
  });

  const items = rows.map((r) => ({
    sym: r.sym,
    shares: Number(r.shares),
    avgCost: r.avgCost ?? undefined,
  }));

  return NextResponse.json({ items });
}

// POST: replace semantics (same UX your portfolio page expects)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getSessionUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bad body" }, { status: 400 });

  let targetId = parsed.data.ownerId ?? uid;
  if (!Number.isFinite(targetId) || targetId <= 0) targetId = uid;
  if (targetId !== uid) {
    const allowed = await ensureViewAccess(uid, targetId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const list = (parsed.data.items ?? [])
    .map((i) => ({
      sym: i.sym.toUpperCase().trim(),
      shares: Number(i.shares) || 0,
      avgCost: i.avgCost === undefined ? null : Number(i.avgCost),
    }))
    .filter((i) => i.sym && i.shares > 0);

  const symbols = Array.from(new Set(list.map((i) => i.sym)));

  await prisma.$transaction(async (tx) => {
    await tx.holding.deleteMany({
      where: { userId: targetId, NOT: { sym: { in: symbols.length ? symbols : ["__none__"] } } },
    });

    for (const h of list) {
      await tx.holding.upsert({
        where: { userId_sym: { userId: targetId, sym: h.sym } },
        create: { userId: targetId, sym: h.sym, shares: h.shares, avgCost: h.avgCost },
        update: { shares: h.shares, avgCost: h.avgCost },
      });
    }
  });

  const rows = await prisma.holding.findMany({
    where: { userId: targetId },
    orderBy: { sym: "asc" },
  });

  const items = rows.map((r) => ({
    sym: r.sym,
    shares: Number(r.shares),
    avgCost: r.avgCost ?? undefined,
  }));

  return NextResponse.json({ items });
}
