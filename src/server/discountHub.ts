import prisma from "@/lib/prisma";
import type { DiscountPositionDto } from "@/types/discount";
import { fetchQuotes } from "@/app/lib/fmp";

type DiscountHistoryEntry = {
  dto: DiscountPositionDto;
  asOfMs: number;
  createdMs: number;
};

function resolveAsOf(row: any): { iso: string; ms: number; createdMs: number } {
  const candidates = [
    row.asOfDate,
    row.article?.datePublished,
    row.article?.summarizedAt,
    row.article?.uploadedAt,
    row.createdAt,
  ];

  for (const dt of candidates) {
    const ts = dt?.getTime?.();
    if (typeof ts === "number" && !Number.isNaN(ts)) {
      const iso = new Date(ts).toISOString();
      const createdMs = row?.createdAt?.getTime?.() ?? ts;
      return { iso, ms: ts, createdMs };
    }
  }

  const fallback = Date.now();
  return { iso: new Date(fallback).toISOString(), ms: fallback, createdMs: fallback };
}

function toDto(row: any): DiscountHistoryEntry {
  const art = row.article ?? {};
  const { iso: asOf, ms: asOfMs, createdMs } = resolveAsOf(row);
  const symbol = (row.symbol || "").toUpperCase();

  const dto: DiscountPositionDto = {
    id: row.id,
    symbol,
    name: row.name ?? null,
    recommendation: row.recommendation ?? null,
    allocation: row.allocation ?? null,
    entryDate: row.entryDate ? row.entryDate.toISOString() : null,
    entryPrice: row.entryPrice ?? null,
    currentPrice: row.currentPrice ?? null,
    returnPct: row.returnPct ?? null,
    fairValue: row.fairValue ?? null,
    stopPrice: row.stopPrice ?? null,
    notes: row.notes ?? null,
    asOf,
    articleId: row.articleId,
    articleTitle: art.title ?? null,
    articleDate: art.datePublished ? art.datePublished.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    livePrice: null,
    liveReturnPct: null,
    priceUsed: row.currentPrice ?? null,
    priceSource: row.currentPrice != null ? "article" : undefined,
    discountPct:
      row.fairValue && row.currentPrice
        ? ((row.fairValue - row.currentPrice) / row.currentPrice) * 100
        : null,
  };

  return { dto, asOfMs, createdMs };
}

type DiscountBuildResult = {
  latest: DiscountPositionDto[];
  history: Record<string, DiscountPositionDto[]>;
};

function buildDiscountDtos(rows: any[]): DiscountBuildResult {
  const historyMap = new Map<string, DiscountHistoryEntry[]>();
  for (const row of rows) {
    const entry = toDto(row);
    const key = entry.dto.symbol?.toUpperCase?.() || "";
    if (!key) continue;
    if (!historyMap.has(key)) historyMap.set(key, []);
    historyMap.get(key)!.push(entry);
  }

  const sorter = (a: DiscountHistoryEntry, b: DiscountHistoryEntry) => {
    const aKey = Number.isFinite(a.asOfMs) ? a.asOfMs : a.createdMs;
    const bKey = Number.isFinite(b.asOfMs) ? b.asOfMs : b.createdMs;
    if (bKey !== aKey) return bKey - aKey;
    return (b.createdMs || 0) - (a.createdMs || 0);
  };

  const latest = Array.from(historyMap.values())
    .map((arr) => {
      const sorted = [...arr].sort(sorter);
      return sorted[0]?.dto;
    })
    .filter((dto): dto is DiscountPositionDto => !!dto)
    .sort((a, b) => {
      const aKey = Date.parse(a.asOf || a.createdAt);
      const bKey = Date.parse(b.asOf || b.createdAt);
      return (Number.isNaN(bKey) ? 0 : bKey) - (Number.isNaN(aKey) ? 0 : aKey);
    });

  const history = Object.fromEntries(
    Array.from(historyMap.entries()).map(([sym, arr]) => [
      sym,
      [...arr].sort(sorter).map((e) => e.dto),
    ])
  );

  return { latest, history };
}

async function attachLiveQuotes(data: DiscountBuildResult) {
  const symbols = Array.from(
    new Set(
      data.latest
        .map((d) => d.symbol?.toUpperCase())
        .filter((s): s is string => !!s)
    )
  );
  if (!symbols.length) return;

  try {
    const quotes = await fetchQuotes(symbols);

    const applyPrice = (dto: DiscountPositionDto) => {
      const sym = dto.symbol?.toUpperCase();
      const q = sym ? quotes[sym] : undefined;
      if (!q || q.price == null) return dto;
      const livePrice = q.price;
      const priceUsed = livePrice ?? dto.currentPrice ?? null;
      const entry = dto.entryPrice ?? null;
      const liveReturnPct = entry && priceUsed ? ((priceUsed - entry) / entry) * 100 : null;
      const discountPct =
        dto.fairValue && priceUsed
          ? ((dto.fairValue - priceUsed) / priceUsed) * 100
          : dto.discountPct ?? null;

      return Object.assign(dto, {
        livePrice,
        liveReturnPct,
        priceUsed,
        priceSource: livePrice != null ? "live" : dto.priceSource,
        discountPct,
      });
    };

    data.latest.forEach(applyPrice);
    Object.values(data.history).forEach((arr) => arr.forEach(applyPrice));
  } catch (err) {
    console.warn("Failed to attach live quotes to discount hub data", err);
  }
}

async function fetchRows(limit = 500) {
  return prisma.discountPosition.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      article: {
        select: {
          id: true,
          title: true,
          datePublished: true,
          summarizedAt: true,
          uploadedAt: true,
        },
      },
    },
  });
}

export async function getDiscountHubData() {
  try {
    const rows = await fetchRows(500);
    const result = buildDiscountDtos(rows);
    await attachLiveQuotes(result);
    return result;
  } catch (err) {
    console.error("Failed to load discount hub data", err);
    return { latest: [] as DiscountPositionDto[], history: {} as Record<string, DiscountPositionDto[]> };
  }
}

export async function getDiscountForSymbol(symbol: string) {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return { latest: null as DiscountPositionDto | null, history: [] as DiscountPositionDto[] };
  }

  try {
    const rows = await prisma.discountPosition.findMany({
      where: { symbol: sym },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        article: {
          select: {
            id: true,
            title: true,
            datePublished: true,
            summarizedAt: true,
            uploadedAt: true,
          },
        },
      },
    });

    const result = buildDiscountDtos(rows);
    await attachLiveQuotes(result);

    return {
      latest: result.latest.find((r) => r.symbol.toUpperCase() === sym) ?? null,
      history: result.history[sym] ?? [],
    };
  } catch (err) {
    console.error("Failed to load discount data for symbol", sym, err);
    return { latest: null as DiscountPositionDto | null, history: [] as DiscountPositionDto[] };
  }
}
