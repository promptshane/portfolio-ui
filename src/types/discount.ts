export type DiscountPositionDto = {
  id: number;
  symbol: string;
  name: string | null;
  recommendation: string | null;
  allocation: number | null;
  entryDate: string | null;
  entryPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
  fairValue: number | null;
  stopPrice: number | null;
  notes: string | null;
  asOf: string;
  articleId: string;
  articleTitle: string | null;
  articleDate: string | null;
  createdAt: string;
  // Live data overlays (filled server-side when available)
  livePrice?: number | null;
  liveReturnPct?: number | null;
  // Price chosen for discount math (livePrice preferred, else stored currentPrice)
  priceUsed?: number | null;
  priceSource?: "live" | "article";
  discountPct?: number | null;
};
