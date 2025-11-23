import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

type MinimalUser = {
  id: string;
  username?: string | null;
  preferredName?: string | null;
};

async function loadAllUsersWithPrisma(): Promise<MinimalUser[] | null> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const rows = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        preferredName: true,
      },
    });

    return rows.map((u: any) => ({
      id: String(u.id),
      username: u.username ?? null,
      preferredName: u.preferredName ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/users
 * Requires dev-mode cookie (ftv_dev=1).
 * Returns a list of users. Primary path: Prisma query.
 * Fallback: current signed-in user via /api/user/profile.
 *
 * Response:
 * { ok: true, users: Array<{ id: string; username?: string; preferredName?: string }> }
 */
export async function GET(req: Request) {
  try {
    const jar = await cookies();
    const dev = jar.get("ftv_dev");
    if (!dev || dev.value !== "1") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Preferred: real multi-user list from Prisma
    const prismaUsers = await loadAllUsersWithPrisma();
    if (Array.isArray(prismaUsers) && prismaUsers.length) {
      const users = prismaUsers.map((u) => ({
        id: u.id,
        username: u.username ?? undefined,
        preferredName: u.preferredName ?? undefined,
      }));
      return NextResponse.json(
        { ok: true, users },
        { headers: { "cache-control": "no-store" } }
      );
    }

    // Fallback: reuse the current user's profile (single-user mode)
    let me: any = null;
    try {
      const url = new URL("/api/user/profile", req.url);
      const cookieHeader = req.headers.get("cookie") || "";
      const r = await fetch(url, {
        headers: {
          cookie: cookieHeader,
          "cache-control": "no-store",
        },
        cache: "no-store",
      });
      if (r.ok) me = await r.json();
    } catch {
      /* noop */
    }

    const users = [
      {
        id: (me?.id as string) || "self",
        username: (me?.username as string) || undefined,
        preferredName: (me?.preferredName as string) || undefined,
      },
    ];

    return NextResponse.json(
      { ok: true, users },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load users" },
      { status: 500 }
    );
  }
}
