export type Quote = {
  symbol: string;
  price: number;
  change: number;
  changesPercentage: number;
  previousClose?: number;
  timestamp?: number;
};

export type QuotesResponse = Record<string, Quote>;