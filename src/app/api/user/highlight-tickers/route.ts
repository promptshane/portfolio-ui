import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAggregatedTickerSets } from "@/server/user/tickers";

export const dynamic = "force-dynamic";

function getUserId(session: unknown): number | null {
  const rawId = (session as { user?: { id?: number | string | null } } | null)?.user?.id;
  if (typeof rawId === "number") return rawId;
  if (typeof rawId === "string") {
    const parsed = Number(rawId);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) {
    return NextResponse.json({ portfolioTickers: [], watchlistTickers: [] }, { status: 200 });
  }

  const { portfolio, watchlist } = await getAggregatedTickerSets(uid);
  return NextResponse.json({ portfolioTickers: portfolio, watchlistTickers: watchlist });
}
