import prisma from "@/lib/prisma";
import type { DiscountPositionDto } from "@/types/discount";
import { fetchQuotes } from "@/app/lib/fmp";

function toDto(row: any): DiscountPositionDto {
  const art = row.article ?? {};
  const asOf =
    row.asOfDate?.toISOString?.() ??
    art.datePublished?.toISOString?.() ??
    art.summarizedAt?.toISOString?.() ??
    art.uploadedAt?.toISOString?.() ??
    row.createdAt.toISOString();

  return {
    id: row.id,
    symbol: row.symbol,
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
}

type DiscountBuildResult = {
  latest: DiscountPositionDto[];
  history: Record<string, DiscountPositionDto[]>;
};

function buildDiscountDtos(rows: any[]): DiscountBuildResult {
  const historyMap = new Map<string, DiscountPositionDto[]>();
  for (const row of rows) {
    const dto = toDto(row);
    const key = dto.symbol.toUpperCase();
    if (!historyMap.has(key)) historyMap.set(key, []);
    historyMap.get(key)!.push(dto);
  }

  const latest = Array.from(historyMap.values())
    .map((arr) => arr[0])
    .sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime());

  const history = Object.fromEntries(
    Array.from(historyMap.entries()).map(([sym, arr]) => [sym, arr])
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
