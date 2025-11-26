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
};
