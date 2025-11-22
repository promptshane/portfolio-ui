// src/app/news/types.ts

// Ticker metadata extracted from summaries
export type NewsTickerDetail = {
  symbol: string;
  name: string;
};

export type NewsFileKind = "pdf" | "text";

// Normalized article used by the News page UI
export type NewsItem = {
  id: string;
  title: string;
  dateISO: string;
  author: string | null;
  summary: string;
  keyPoints: string[];
  actions: string[];
  tickers: string[];
  tickerDetails: NewsTickerDetail[];
  viewed: boolean;
  hasPortfolioTicker: boolean;
  hasWatchlistTicker: boolean;
  // Subset of tickers that are in the user's portfolio/watchlist (UPPERCASE)
  portfolioTickers: string[];
  watchlistTickers: string[];
  fileKind: NewsFileKind;
};

// Raw article shape returned by the /api/news/articles endpoint
export type ApiArticle = {
  id: string;
  originalFilename: string;
  uploadedAt: string;
  hasSummary: boolean;
  title: string | null;
  author: string | null;
  datePublished: string | null;
  summaryText: string | null;
  keyPointsJson: string | null;
  actionsJson: string | null;
  tickersJson: string | null;
  summarizedAt: string | null;
  viewed?: boolean;
  hasPortfolioTicker?: boolean;
  hasWatchlistTicker?: boolean;
  // Optional per-article portfolio matches coming from the API
  portfolioTickers?: string[];
  watchlistTickers?: string[];
  fileKind?: NewsFileKind;
};

// Q&A entry for per-article questions and answers
export type QaEntry = {
  id: string; // server-side question ID (or local temp ID)
  question: string;
  answer?: string;
  createdAtISO?: string;
};

// UI state for the Q&A panel attached to a single article
export type QaUIState = {
  open: boolean;
  input: string;
  entries: QaEntry[];
  loading: boolean; // "Get answers" in-flight
  error: string | null;
};

// Available timeframe filters for the News page
export type TimeframeOption = "1D" | "1W" | "1M" | "1Y";

export type NewsJobInfo = {
  id: number;
  type: "summarize" | "resummarize" | "refresh";
  status: "pending" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  summary: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
