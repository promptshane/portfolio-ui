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

function parseDiscountData(discountJson: string | null): {
  ongoingActions: string[];
  ongoingTickers: string[];
} {
  const result = { ongoingActions: [] as string[], ongoingTickers: [] as string[] };
  if (!discountJson) return result;

  const formatMoney = (value: any) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return `$${num.toLocaleString(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })}`;
  };

  try {
    const parsed = JSON.parse(discountJson);

    const actionsSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).ongoing_actions)
        ? (parsed as any).ongoing_actions
        : null;
    if (actionsSource) {
      for (const a of actionsSource) {
        if (typeof a === "string") {
          result.ongoingActions.push(a);
          continue;
        }
        if (a && typeof a.description === "string") {
          result.ongoingActions.push(a.description);
        }
        if (a && typeof a.ticker === "string" && a.ticker.trim()) {
          result.ongoingTickers.push(a.ticker.trim().toUpperCase());
        }
      }
    }

    const positionsSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).positions)
        ? (parsed as any).positions
        : null;
    if (positionsSource) {
      for (const pos of positionsSource) {
        const symbol = typeof pos?.symbol === "string" ? pos.symbol.trim().toUpperCase() : "";
        const name = typeof pos?.name === "string" ? pos.name.trim() : "";
        const rec = typeof pos?.recommendation === "string" ? pos.recommendation.trim() : "";
        const fairValue = formatMoney(pos?.fair_value ?? pos?.fairValue);
        const stopPrice = formatMoney(pos?.stop_price ?? pos?.stopPrice);
        const entryPrice = formatMoney(pos?.entry_price ?? pos?.entryPrice);

        const label = [symbol, name].filter(Boolean).join(" — ") || "Position";
        const parts: string[] = [];
        if (rec) parts.push(rec);
        if (entryPrice) parts.push(`entry ${entryPrice}`);
        if (fairValue) parts.push(`buy-up-to ${fairValue}`);
        if (stopPrice) parts.push(`stop ${stopPrice}`);

        const detail = parts.length ? parts.join("; ") : "continued guidance";
        result.ongoingActions.push(
          `Maintain ${detail} for ${label} (ongoing guidance).`
        );
        if (symbol) result.ongoingTickers.push(symbol);
      }
    }

    const tickersSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).ongoing_tickers)
        ? (parsed as any).ongoing_tickers
        : null;
    if (tickersSource) {
      for (const t of tickersSource) {
        if (typeof t === "string" && t.trim()) {
          result.ongoingTickers.push(t.trim().toUpperCase());
        } else if (t && typeof t.symbol === "string" && t.symbol.trim()) {
          result.ongoingTickers.push(t.symbol.trim().toUpperCase());
        }
      }
    }
  } catch {
    /* ignore parse errors */
  }

  result.ongoingActions = result.ongoingActions.filter(Boolean);
  result.ongoingTickers = Array.from(new Set(result.ongoingTickers));
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

  const appendTicker = (symbol: string, name: string) => {
    const sym = symbol.trim();
    if (!sym) return;
    tickers.push(sym);
    tickerDetails.push({ symbol: sym, name });
  };

  if (a.tickersJson) {
    try {
      const parsed = JSON.parse(a.tickersJson);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string") {
            appendTicker(v, "");
          } else if (v && typeof (v as any).symbol === "string") {
            const symbol = (v as any).symbol.trim();
            if (!symbol) continue;
            const name =
              typeof (v as any).name === "string"
                ? (v as any).name.trim()
                : "";
            appendTicker(symbol, name);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  const { ongoingActions, ongoingTickers } = parseDiscountData(a.discountJson ?? null);

  if (Array.isArray(a.positionTickers)) {
    for (const v of a.positionTickers) {
      if (typeof v === "string" && v.trim()) ongoingTickers.push(v.trim().toUpperCase());
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
    ongoingActions,
    ongoingTickers: Array.from(new Set(ongoingTickers)),
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
