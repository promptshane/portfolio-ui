// src/app/news/utils.ts
import type {
  ApiArticle,
  NewsItem,
  NewsTickerDetail,
  QaEntry,
  QaUIState,
} from "./types";

/**
 * Format ISO date/time into a human-readable string.
 */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Escape a string for use in a RegExp.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Insert "(TICKER)" after company names in summary / key points / actions.
 */
export function decorateTextWithTickers(
  text: string,
  tickerDetails: NewsTickerDetail[]
): string {
  if (!text || !tickerDetails.length) return text;

  let result = text;

  for (const detail of tickerDetails) {
    const name = (detail.name || "").trim();
    const symbol = (detail.symbol || "").trim();
    if (!name || !symbol) continue;

    const label = `${name} (${symbol.toUpperCase()})`;

    // If it's already present, skip
    if (result.includes(label)) continue;

    // Replace whole-word matches of the company name that are not already
    // followed by parentheses (to avoid "Name (XYZ) (XYZ)")
    const pattern = new RegExp(
      `\\b${escapeRegExp(name)}\\b(?!\\s*\\()`,
      "g"
    );

    result = result.replace(pattern, label);
  }

  return result;
}

/**
 * Map the raw API article shape into the normalized NewsItem used by the UI.
 */
export function mapApiArticleToNewsItem(a: ApiArticle): NewsItem | null {
  if (!a.hasSummary || !a.summaryText) return null;

  // Prefer publish date, then summarizedAt, then uploadedAt
  const dateISO = a.datePublished || a.summarizedAt || a.uploadedAt;

  let keyPoints: string[] = [];
  if (a.keyPointsJson) {
    try {
      const parsed = JSON.parse(a.keyPointsJson);
      if (Array.isArray(parsed)) {
        keyPoints = parsed.map((v) => String(v));
      }
    } catch {
      // ignore parse errors, fall back to empty list
    }
  }

  let actions: string[] = [];
  if (a.actionsJson) {
    try {
      const parsed = JSON.parse(a.actionsJson);
      if (Array.isArray(parsed)) {
        actions = parsed
          .map((v: any) => {
            if (typeof v === "string") return v;
            if (v && typeof v.description === "string") return v.description;
            return "";
          })
          .filter(Boolean);
      }
    } catch {
      // ignore parse errors
    }
  }

  let tickers: string[] = [];
  const tickerDetails: NewsTickerDetail[] = [];

  if (a.tickersJson) {
    try {
      const parsed = JSON.parse(a.tickersJson);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string") {
            const symbol = v.trim();
            if (symbol) {
              tickers.push(symbol);
              tickerDetails.push({ symbol, name: "" });
            }
          } else if (v && typeof (v as any).symbol === "string") {
            const symbol = (v as any).symbol.trim();
            if (!symbol) continue;
            const name =
              typeof (v as any).name === "string"
                ? (v as any).name.trim()
                : "";
            tickers.push(symbol);
            tickerDetails.push({ symbol, name });
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Deduplicate tickers and tickerDetails by symbol
  if (tickers.length) {
    const seen = new Set<string>();
    const uniqueTickers: string[] = [];
    for (const sym of tickers) {
      const upper = sym.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      uniqueTickers.push(sym);
    }
    tickers = uniqueTickers;

    const uniqueDetails: NewsTickerDetail[] = [];
    const seenDetail = new Set<string>();
    for (const detail of tickerDetails) {
      const key = detail.symbol.toUpperCase();
      if (seenDetail.has(key)) continue;
      seenDetail.add(key);
      uniqueDetails.push(detail);
    }

    tickerDetails.splice(0, tickerDetails.length, ...uniqueDetails);
  }

  const title =
    (a.title && a.title.trim().length > 0 ? a.title : a.originalFilename) ??
    "Untitled article";

  const author =
    a.author && a.author.trim().length > 0 ? a.author.trim() : null;

  // Normalize portfolio tickers: UPPERCASE, deduped
  const apiPortfolioTickers = Array.isArray(a.portfolioTickers)
    ? a.portfolioTickers
    : [];

  const portfolioTickers = Array.from(
    new Set(
      apiPortfolioTickers
        .map((sym) =>
          typeof sym === "string" ? sym.trim().toUpperCase() : ""
        )
        .filter(Boolean)
    )
  );

  const hasPortfolioTicker =
    typeof a.hasPortfolioTicker === "boolean"
      ? a.hasPortfolioTicker
      : portfolioTickers.length > 0;

  const apiWatchlistTickers = Array.isArray(a.watchlistTickers)
    ? a.watchlistTickers
    : [];

  const watchlistTickers = Array.from(
    new Set(
      apiWatchlistTickers
        .map((sym) =>
          typeof sym === "string" ? sym.trim().toUpperCase() : ""
        )
        .filter(Boolean)
    )
  );

  const hasWatchlistTicker =
    typeof a.hasWatchlistTicker === "boolean"
      ? a.hasWatchlistTicker
      : watchlistTickers.length > 0;

  const fileKind = a.fileKind ??
    (typeof a.originalFilename === "string" && a.originalFilename.toLowerCase().endsWith(".txt")
      ? "text"
      : "pdf");

  return {
    id: a.id,
    title,
    dateISO,
    author,
    summary: a.summaryText || "",
    keyPoints,
    actions,
    tickers,
    tickerDetails,
    viewed: !!a.viewed,
    hasPortfolioTicker,
    portfolioTickers,
    hasWatchlistTicker,
    watchlistTickers,
    fileKind,
  };
}

/**
 * Merge local UI entries with history loaded from the server.
 * Server entries win (they include stored answers & IDs); any purely local
 * questions not yet in history are appended (deduped by question text).
 */
export function mergeEntries(
  local: QaEntry[],
  fromServer: QaEntry[]
): QaEntry[] {
  if (!fromServer.length) return local;

  const serverQuestions = fromServer
    .map((e) => (e.question || "").trim())
    .filter(Boolean);
  const serverSet = new Set(serverQuestions);

  const extras = local.filter((e) => {
    const q = (e.question || "").trim();
    return q && !serverSet.has(q);
  });

  return [...fromServer, ...extras];
}

/**
 * Helper to generate a local temporary ID for questions not yet persisted.
 */
export function makeLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Factory for a fresh QaUIState, used both in the page and helpers.
 */
export function getDefaultQaState(): QaUIState {
  return {
    open: false,
    input: "",
    entries: [],
    loading: false,
    error: null,
  };
}
