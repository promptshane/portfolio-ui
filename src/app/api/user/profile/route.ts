import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildUserFilters(session: any) {
  const filters: Array<{ id?: number; username?: string }> = [];
  const idRaw = session?.user?.id;
  const handleRaw = session?.user?.username;
  const uid = Number.parseInt(idRaw ?? "", 10);
  if (Number.isFinite(uid)) filters.push({ id: uid });
  if (typeof handleRaw === "string" && handleRaw.trim()) {
    const raw = handleRaw.trim();
    filters.push({ username: raw });
    const lower = raw.toLowerCase();
    if (lower !== raw) filters.push({ username: lower });
  }
  return filters;
}

// GET → { username, preferredName, email, colorPalette }
export async function GET() {
  const session = await getServerSession(authOptions);
  const filters = buildUserFilters(session);
  if (!filters.length) return NextResponse.json({}, { status: 200 });

  const where =
    filters.length === 1 ? filters[0] : { OR: filters.map((f) => ({ ...f })) };

  const u = await prisma.user.findFirst({
    where,
    select: {
      username: true,
      preferredName: true,
      email: true,
      colorPalette: true,
      overseenBy: {
        select: {
          overseer: { select: { username: true, preferredName: true } },
        },
      },
    },
  });

  if (!u) return NextResponse.json({});
  const overseenBy =
    u.overseenBy?.map((link) => ({
      username: link.overseer.username,
      preferredName: link.overseer.preferredName,
    })) ?? [];

  return NextResponse.json({ ...u, overseenBy });
}

// POST → body: { preferredName?: string, username?: string, colorPalette?: "classic" | "icy" | "violet" | "luxe" | "blueAmberTeal" | "crimsonVioletMint" }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const filters = buildUserFilters(session);
  if (!filters.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.user.findFirst({
    where:
      filters.length === 1 ? filters[0] : { OR: filters.map((f) => ({ ...f })) },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const preferredName =
    typeof body?.preferredName === "string" ? body.preferredName.trim() : undefined;
  const username =
    typeof body?.username === "string" ? body.username.trim() : undefined;
  const colorPaletteRaw =
    typeof body?.colorPalette === "string" ? body.colorPalette.trim() : undefined;

  const data: Record<string, any> = {};
  if (preferredName !== undefined) data.preferredName = preferredName || null;
  if (username !== undefined) data.username = username;

  if (colorPaletteRaw !== undefined) {
    const lower = colorPaletteRaw.toLowerCase();
    const paletteMap: Record<string, string> = {
      default: "classic",
      classic: "classic",
      icy: "icy",
      violet: "violet",
      luxe: "luxe",
      blueamberteal: "blueAmberTeal",
      crimsonvioletmint: "crimsonVioletMint",
    };
    const mapped = paletteMap[lower];
    if (mapped) data.colorPalette = mapped;
    else return NextResponse.json({ error: "Invalid colorPalette" }, { status: 400 });
  }

  if (!Object.keys(data).length) return NextResponse.json({ ok: true });

  try {
    const u = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: { username: true, preferredName: true, email: true, colorPalette: true },
    });
    return NextResponse.json(u);
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }
}
