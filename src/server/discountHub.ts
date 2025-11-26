import prisma from "@/lib/prisma";
import type { DiscountPositionDto } from "@/types/discount";

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
  };
}

export async function getDiscountHubData() {
  try {
    const rows = await prisma.discountPosition.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
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
  } catch (err) {
    console.error("Failed to load discount hub data", err);
    return { latest: [] as DiscountPositionDto[], history: {} as Record<string, DiscountPositionDto[]> };
  }
}
