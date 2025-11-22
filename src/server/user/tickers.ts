// src/server/user/tickers.ts
import prisma from "@/lib/prisma";
import { ensureTable as ensureOverseerTable } from "@/app/api/oversee/route";

function normalizeSymbol(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export type AggregatedTickerSets = {
  portfolio: string[];
  watchlist: string[];
};

export async function getAggregatedTickerSets(
  userId: number
): Promise<AggregatedTickerSets> {
  if (!userId) {
    return { portfolio: [], watchlist: [] };
  }

  await ensureOverseerTable();

  const overseen = await prisma.overseerLink.findMany({
    where: { overseerId: userId },
    select: { targetId: true },
  });

  const targetIds = overseen.map((link) => link.targetId);
  const userIds = [userId, ...targetIds];

  const [holdings, watchlist] = await Promise.all([
    prisma.holding.findMany({
      where: { userId: { in: userIds } },
      select: { sym: true },
    }),
    prisma.watchlistItem.findMany({
      where: { userId: { in: userIds } },
      select: { symbol: true },
    }),
  ]);

  const portfolioSet = new Set<string>();
  for (const holding of holdings) {
    const sym = normalizeSymbol(holding.sym);
    if (sym) portfolioSet.add(sym);
  }

  const watchlistSet = new Set<string>();
  for (const item of watchlist) {
    const sym = normalizeSymbol(item.symbol);
    if (sym) {
      watchlistSet.add(sym);
    }
  }

  return {
    portfolio: Array.from(portfolioSet).sort(),
    watchlist: Array.from(watchlistSet).sort(),
  };
}
