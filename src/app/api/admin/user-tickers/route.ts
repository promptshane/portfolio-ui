import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

type TickerList = string[];

function uniqUpper(list: string[]): string[] {
  const s = new Set<string>();
  for (const v of list) {
    const t = (v || "").trim().toUpperCase();
    if (t) s.add(t);
  }
  return Array.from(s).sort();
}

// ---------- Prisma ----------
async function getPrisma(): Promise<PrismaClient | null> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    return new PrismaClient();
  } catch {
    return null;
  }
}

// Fetch tickers for a specific userId directly from your Prisma models.
async function fetchTickersFromDb(
  prisma: PrismaClient,
  userIdNum: number
): Promise<{ watchlist: string[]; portfolio: string[] }> {
  // Watchlist symbols
  const wlRows =
    (await prisma.watchlistItem.findMany({
      where: { userId: userIdNum },
      select: { symbol: true },
    })) as Array<{ symbol: string }>;

  // Holdings symbols (portfolio)
  const pfRows =
    (await prisma.holding.findMany({
      where: { userId: userIdNum },
      select: { sym: true },
    })) as Array<{ sym: string }>;

  const watchlist = uniqUpper(wlRows.map((r) => r.symbol));
  const portfolio = uniqUpper(pfRows.map((r) => r.sym));
  return { watchlist, portfolio };
}

// ---------- Fallback helpers (only used if Prisma isn't available or id isn't numeric) ----------
async function tryFetchJSON(url: URL, req: Request) {
  try {
    const r = await fetch(url, {
      headers: {
        cookie: req.headers.get("cookie") || "",
        "cache-control": "no-store",
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function coerceTickers(payload: any): TickerList {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((t) => typeof t === "string");
  if (Array.isArray(payload?.tickers)) return payload.tickers.filter((t: any) => typeof t === "string");
  if (Array.isArray(payload?.symbols)) return payload.symbols.filter((t: any) => typeof t === "string");
  return [];
}

// ---------- Main builder ----------
async function buildResponse(req: Request, userIds: string[]) {
  const base = new URL(req.url);

  // Load Prisma (preferred path)
  const prisma = await getPrisma();

  // Build a small map of { id(string) -> { username, preferredName } } for labels.
  const userLabelMap: Record<string, { username?: string; preferredName?: string }> = {};
  if (prisma) {
    // Parse numeric ids we can actually query.
    const numericIds = userIds
      .map((id) => (Number.isFinite(Number(id)) ? Number(id) : null))
      .filter((n): n is number => n !== null);

    if (numericIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: numericIds } },
        select: { id: true, username: true, preferredName: true },
      });
      for (const u of users) {
        userLabelMap[String(u.id)] = {
          username: u.username ?? undefined,
          preferredName: u.preferredName ?? undefined,
        };
      }
    }
  }

  // If any "self" id is requested, try best-effort to label it via /api/user/profile
  if (userIds.includes("self")) {
    const me = await tryFetchJSON(new URL("/api/user/profile", base.origin), req);
    if (me) {
      userLabelMap["self"] = {
        username: me?.username ?? undefined,
        preferredName: me?.preferredName ?? undefined,
      };
    }
  }

  const results = [];

  for (const id of userIds) {
    let watchlist: string[] = [];
    let portfolio: string[] = [];

    // Preferred: Prisma per-user (when we have a numeric id and Prisma is available)
    if (prisma && Number.isFinite(Number(id))) {
      const { watchlist: wl, portfolio: pf } = await fetchTickersFromDb(prisma, Number(id));
      watchlist = wl;
      portfolio = pf;
    }

    // Fallback: current-user style endpoints (covers "self" or non-numeric ids, or when Prisma isn't available)
    if (!watchlist.length && !portfolio.length) {
      const candidates = {
        watchlist: ["/api/user/watchlist", "/api/watchlist", "/api/portfolio/watchlist"],
        portfolio: ["/api/user/portfolio", "/api/portfolio", "/api/holdings"],
      };

      let wl: string[] = [];
      for (const p of candidates.watchlist) {
        const j = await tryFetchJSON(new URL(p, base.origin), req);
        wl = coerceTickers(j);
        if (wl.length) break;
      }

      let pf: string[] = [];
      for (const p of candidates.portfolio) {
        const j = await tryFetchJSON(new URL(p, base.origin), req);
        pf = coerceTickers(j);
        if (pf.length) break;
      }

      watchlist = uniqUpper(wl);
      portfolio = uniqUpper(pf);
    }

    // Last-resort seed so the UI isn’t empty in totally bare setups
    if (!watchlist.length && !portfolio.length) {
      watchlist = ["AAPL", "MSFT", "NVDA"];
      portfolio = ["SPY", "GOOGL", "AMZN"];
    }

    results.push({
      userId: String(id),
      username: userLabelMap[String(id)]?.username,
      preferredName: userLabelMap[String(id)]?.preferredName,
      watchlist,
      portfolio,
    });
  }

  return NextResponse.json(
    { ok: true, data: results },
    { headers: { "cache-control": "no-store" } }
  );
}

/**
 * POST /api/admin/user-tickers
 * Body: { userIds?: string[] }
 * Requires dev-mode cookie (ftv_dev=1).
 */
export async function POST(req: Request) {
  try {
    const dev = cookies().get("ftv_dev");
    if (!dev || dev.value !== "1") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* noop */
    }
    const userIds: string[] =
      Array.isArray(body?.userIds) && body.userIds.length ? body.userIds : ["self"];

    return await buildResponse(req, userIds);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load tickers" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/user-tickers?ids=u1,u2
 * Requires dev-mode cookie (ftv_dev=1).
 */
export async function GET(req: Request) {
  try {
    const dev = cookies().get("ftv_dev");
    if (!dev || dev.value !== "1") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const idsParam = url.searchParams.get("ids") || "";
    const parsed = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const userIds = parsed.length ? parsed : ["self"];

    return await buildResponse(req, userIds);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load tickers" },
      { status: 500 }
    );
  }
}
