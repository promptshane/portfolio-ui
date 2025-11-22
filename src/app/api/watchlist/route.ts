import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: { items: { sym: string }[] } */
export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = Number((session as any)?.user?.id);
  if (!uid) return NextResponse.json({ items: [] }, { status: 200 });

  const rows = await prisma.watchlistItem.findMany({
    where: { userId: uid },
    orderBy: { symbol: "asc" },
    select: { symbol: true },
  });

  return NextResponse.json({
    items: rows.map((r) => ({ sym: r.symbol })),
  });
}

/** POST: { items: { sym: string }[] } – replace semantics */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = Number((session as any)?.user?.id);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const symbols = Array.from(
    new Set(
      (Array.isArray(body?.items) ? body.items : [])
        .map((x: any) => (x?.sym || "").toUpperCase().trim())
        .filter(Boolean)
    )
  );

  await prisma.$transaction(async (tx) => {
    await tx.watchlistItem.deleteMany({
      where: { userId: uid, NOT: { symbol: { in: symbols.length ? symbols : ["__none__"] } } },
    });

    for (const sym of symbols) {
      await tx.watchlistItem.upsert({
        where: { userId_symbol: { userId: uid, symbol: sym } },
        create: { userId: uid, symbol: sym },
        update: {},
      });
    }
  });

  const rows = await prisma.watchlistItem.findMany({
    where: { userId: uid },
    orderBy: { symbol: "asc" },
    select: { symbol: true },
  });

  return NextResponse.json({
    items: rows.map((r) => ({ sym: r.symbol })),
  });
}
