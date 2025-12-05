"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/header";
import type { DiscountPositionDto } from "@/types/discount";

type HubResponse = {
  ok: boolean;
  latest?: DiscountPositionDto[];
  history?: Record<string, DiscountPositionDto[]>;
  error?: string;
};

type FtvLatest = {
  symbol: string;
  ftvEstimate?: number;
  ftvAsOf?: string;
  confirmedAt?: string;
  uploadedAt?: string;
};

function fmtDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function fmtDateTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function fmtMoney(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const badgeColors: Record<string, string> = {
  BUY: "text-[var(--good-100)] border-[var(--good-500)] bg-[color:var(--good-500)/0.16]",
  HOLD: "text-[var(--mid-100)] border-[var(--mid-500)] bg-[color:var(--mid-500)/0.18]",
  SELL: "text-[var(--bad-200)] border-[var(--bad-500)] bg-[color:var(--bad-500)/0.18]",
};
function resolveBadgeClass(raw?: string | null) {
  const recKey = (raw || "").trim().toUpperCase();
  if (recKey.startsWith("BUY")) return badgeColors.BUY;
  if (recKey.startsWith("SELL")) return badgeColors.SELL;
  if (recKey.startsWith("HOLD")) return badgeColors.HOLD;
  if (badgeColors[recKey]) return badgeColors[recKey];
  return "text-neutral-200 border-neutral-600 bg-black/60";
}

const LIST_COUNTS = [10, 25, 50, 100];

export default function DiscountHubPage() {
  const [latest, setLatest] = useState<DiscountPositionDto[]>([]);
  const [history, setHistory] = useState<Record<string, DiscountPositionDto[]>>({});
  const [ftvLatest, setFtvLatest] = useState<FtvLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listCount, setListCount] = useState<number>(10);
  const [sortMode, setSortMode] = useState<"buy" | "sell">("buy");
  const [includeNews, setIncludeNews] = useState(true);
  const [includeFtv, setIncludeFtv] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, { price: number | null; changesPercentage: number | null }>>({});
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesLoaded, setQuotesLoaded] = useState(0);
  const [loadingDots, setLoadingDots] = useState(".");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const autoRetryRef = useRef(false);

  const symbols = useMemo(() => {
    return Array.from(
      new Set(
        [...latest, ...ftvLatest.map((f) => ({ symbol: f.symbol, fairValue: f.ftvEstimate } as any))]
          .filter((i) => i.fairValue != null)
          .map((i) => (i.symbol || "").toUpperCase())
          .filter((s): s is string => !!s)
      )
    );
  }, [latest, ftvLatest]);

  useEffect(() => {
    if (!symbols.length) {
      setQuotes({});
      setQuotesLoaded(0);
      setQuotesError(null);
      setQuotesLoading(false);
      return;
    }

    let cancelled = false;
    let hadError = false;
    setQuotes({});
    setQuotesLoaded(0);
    setQuotesError(null);
    setQuotesLoading(true);

    const chunkSize = 40; // keep URLs reasonable and reduce FMP errors

    (async () => {
      const collected: Record<string, { price: number | null; changesPercentage: number | null }> = {};
      async function runChunks(target: string[]) {
        for (let i = 0; i < target.length; i += chunkSize) {
          const chunk = target.slice(i, i + chunkSize);
          try {
            const res = await fetch(`/api/market/quotes?symbols=${chunk.join(",")}`, { cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            if (cancelled) return;
            if (res.ok && json?.data) {
              Object.assign(collected, json.data);
              const loaded = Object.keys(collected).length;
              setQuotes({ ...collected });
              setQuotesLoaded(Math.min(symbols.length, loaded));
            } else if (!hadError) {
              hadError = true;
              setQuotesError(json?.error || `Quotes HTTP ${res.status}`);
            }
          } catch (err: any) {
            if (!cancelled && !hadError) {
              hadError = true;
              setQuotesError(String(err?.message || err));
            }
          }
        }
      }

      let attempt = 0;
      let remaining = [...symbols];
      while (attempt < 3 && remaining.length && !cancelled) {
        await runChunks(remaining);
        remaining = symbols.filter((s) => !(s in collected));
        attempt += 1;
        if (remaining.length && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }

      if (!cancelled) {
        if (remaining.length && hadError) {
          setQuotesError((prev) => prev || "Some quotes unavailable after retries.");
        }
        setQuotesLoaded(Object.keys(collected).length);
        setQuotesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbols, refreshNonce]);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const [newsRes, ftvRes] = await Promise.all([
          fetch("/api/discounts", { cache: "no-store" }),
          fetch("/api/ftv/all-latest", { cache: "no-store" }),
        ]);

        const newsData: HubResponse = await newsRes.json();
        const ftvData: { ok: boolean; items?: FtvLatest[]; error?: string } = await ftvRes
          .json()
          .catch(() => ({ ok: false }));

        if (!newsRes.ok || !newsData.ok) {
          throw new Error(newsData?.error || `HTTP ${newsRes.status}`);
        }
        if (aborted) return;
        const latestRows = (newsData.latest ?? []).filter((row) => row && row.symbol);
        setLatest(latestRows);
        setHistory(newsData.history ?? {});

        if (ftvRes.ok && ftvData?.ok) {
          setFtvLatest(ftvData.items ?? []);
        } else {
          setFtvLatest([]);
        }

        if (latestRows.length > 0) {
          autoRetryRef.current = false;
        }

        if (!latestRows.length && !autoRetryRef.current) {
          autoRetryRef.current = true;
          setTimeout(() => setRefreshNonce((n) => n + 1), 2500);
        }
      } catch (err: any) {
        if (!aborted) setError(err?.message || "Failed to load discount data.");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [refreshNonce]);

  // Animated "Loading..." subtitle while quotes are being fetched
  useEffect(() => {
    if (!quotesLoading && !loading) return;
    let dots = ".";
    const id = setInterval(() => {
      dots = dots.length >= 3 ? "." : `${dots}.`;
      setLoadingDots(dots);
    }, 450);
    return () => clearInterval(id);
  }, [quotesLoading, loading]);

  const subtitleText = (() => {
    const showLoading = quotesLoading || loading || (symbols.length > 0 && quotesLoaded === 0);
    if (showLoading) return `Loading${loadingDots}`;
    return `Live prices: ${quotesLoaded}/${symbols.length || 0} loaded${quotesError ? ` • ${quotesError}` : ""}`;
  })();

  const handleRefresh = () => {
    setQuotes({});
    setQuotesLoaded(0);
    setQuotesError(null);
    setQuotesLoading(true);
    autoRetryRef.current = false;
    setRefreshNonce((n) => n + 1);
  };

  const handleOpenArticle = (articleId?: string) => {
    const id = (articleId || "").trim();
    if (!id) return;
    const url = `/api/news/articles/${encodeURIComponent(id)}/file`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const hydratedLatest = useMemo(() => {
    if (!latest.length) return latest;
    return latest.map((item) => {
      const sym = (item.symbol || "").toUpperCase();
      const quote = sym ? quotes?.[sym] : undefined;
      const livePrice = Number.isFinite(quote?.price) ? Number(quote?.price) : null;
      const priceUsed = livePrice ?? item.currentPrice ?? null;
      const entry = item.entryPrice ?? null;
      const liveReturnPct = entry && priceUsed ? ((priceUsed - entry) / entry) * 100 : null;
      const discountPct =
        item.fairValue && priceUsed
          ? ((item.fairValue - priceUsed) / priceUsed) * 100
          : null;
      return {
        ...item,
        livePrice,
        priceUsed,
        priceSource: livePrice != null ? "live" : undefined,
        liveReturnPct,
        discountPct,
      };
    });
  }, [latest, quotes]);

  const hydratedFtv = useMemo(() => {
    if (!ftvLatest.length) return [] as DiscountPositionDto[];
    return ftvLatest.map((item) => {
      const sym = (item.symbol || "").toUpperCase();
      const quote = sym ? quotes?.[sym] : undefined;
      const livePrice = Number.isFinite(quote?.price) ? Number(quote?.price) : null;
      const fairValue = typeof item.ftvEstimate === "number" ? item.ftvEstimate : null;
      const priceUsed = livePrice ?? null;
      const discountPct = fairValue && priceUsed ? ((fairValue - priceUsed) / priceUsed) * 100 : null;
      const asOf = item.ftvAsOf ?? item.confirmedAt ?? item.uploadedAt ?? new Date().toISOString();
      return {
        id: Number.NaN,
        symbol: sym,
        name: null,
        recommendation: "—",
        allocation: null,
        entryDate: null,
        entryPrice: null,
        currentPrice: null,
        returnPct: null,
        fairValue,
        stopPrice: null,
        notes: null,
        asOf,
        articleId: "",
        articleTitle: "",
        articleDate: null,
        createdAt: asOf,
        livePrice,
        liveReturnPct: null,
        priceUsed,
        priceSource: livePrice != null ? "live" : undefined,
        discountPct,
      } as DiscountPositionDto;
    });
  }, [ftvLatest, quotes]);

  const tickerHighlights = useMemo(() => {
    const rows = [
      ...(includeNews ? hydratedLatest : []),
      ...(includeFtv ? hydratedFtv : []),
    ]
      .map((item) => {
        const price = item.priceUsed ?? item.livePrice ?? null;
        const fv = item.fairValue ?? null;
        if (price == null || fv == null) return null;
        const discountPct = ((fv - price) / price) * 100;
        return {
          symbol: item.symbol,
          name: item.name ?? undefined,
          discountPct,
          fairValue: fv,
          price,
          priceSource: item.priceSource,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);

    rows.sort((a, b) =>
      sortMode === "buy" ? b.discountPct - a.discountPct : a.discountPct - b.discountPct
    );
    return rows;
  }, [hydratedLatest, hydratedFtv, sortMode, includeNews, includeFtv]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="Discount Hub"
        subtitle={subtitleText}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh live prices"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-700 bg-neutral-800 hover:border-[var(--highlight-400)] focus:outline-none focus:ring-2 focus:ring-[var(--highlight-400)]"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-label="Toggle info"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-700 bg-neutral-800 hover:border-[var(--good-400)] focus:outline-none focus:ring-2 focus:ring-[var(--good-400)]"
            >
              ?
            </button>
          </div>
        }
      />

      <div className="space-y-4">
        {showInfo && (
          <div className="bg-neutral-825 border border-neutral-800 rounded-2xl p-5 text-sm text-neutral-300">
            We capture Buy/Hold/Sell grids from incoming research and surface the most recent call for each ticker.
            Older entries stay archived under each symbol for context.
          </div>
        )}

        {/* Top discounts list */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">Most discounted tickers</h3>
              <p className="text-xs text-neutral-400">
                Live price (FMP) only; rows appear once a live quote is fetched. Sorted by discount vs FTV.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-400">Order:</span>
              {(["buy", "sell"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  className={`rounded-md border px-2 py-1 ${
                    sortMode === mode
                      ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                      : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                  }`}
                >
                  {mode === "buy" ? "Buys" : "Sells"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-300">
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeNews}
                  onChange={(e) => setIncludeNews(e.target.checked)}
                  className="accent-[var(--highlight-400)]"
                />
                News Data
              </label>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFtv}
                  onChange={(e) => setIncludeFtv(e.target.checked)}
                  className="accent-[var(--highlight-400)]"
                />
                Morningstar Data
              </label>
            </div>
            {!loading && !!tickerHighlights.length && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-400">Show</span>
                {LIST_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setListCount(n)}
                    className={`rounded-md border px-2 py-1 ${
                      listCount === n
                        ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                        : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <div className="mt-3 rounded-xl border border-neutral-800 bg-black/30 px-3 py-2 text-neutral-300">
              Loading discounts…
            </div>
          ) : !tickerHighlights.length ? (
            <div className="mt-3 rounded-xl border border-neutral-800 bg-black/30 px-3 py-2 text-neutral-400">
              No FTV discounts yet.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {tickerHighlights.slice(0, listCount).map((row) => (
                <button
                  key={row.symbol}
                  type="button"
                  onClick={() =>
                    window.open(`/analysis?ticker=${encodeURIComponent(row.symbol)}`, "_blank", "noopener,noreferrer")
                  }
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-left hover:border-[var(--highlight-400)] transition-colors"
                >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold tracking-wide">{row.symbol}</span>
                      {row.name && <span className="text-xs text-neutral-500">{row.name}</span>}
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-semibold ${
                          row.discountPct >= 5
                            ? "text-[var(--good-200)]"
                            : row.discountPct <= -5
                            ? "text-[var(--bad-200)]"
                            : "text-[var(--mid-100)]"
                        }`}
                      >
                        {row.discountPct.toFixed(1)}%
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        FV {fmtMoney(row.fairValue)} • Price {fmtMoney(row.price)}
                      </div>
                      </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {loading ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-neutral-300">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--bad-500)] bg-[color:var(--bad-500)/0.15] p-4 text-[var(--bad-100)]">
            {error}
          </div>
        ) : !latest.length ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-neutral-300">
            No discount data yet. Summaries will populate here after the next refresh.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {hydratedLatest.map((item) => {
              const recClass = resolveBadgeClass(item.recommendation);
              const hist = history[item.symbol] ?? [];
              const hasOlder = hist.length > 1;
              return (
                <div
                  key={`${item.symbol}-${item.id}`}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-inner"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xl font-semibold tracking-wide">
                        {item.symbol}
                        {item.name ? <span className="text-neutral-400 text-sm ml-2">{item.name}</span> : null}
                      </div>
                      <div className="text-xs text-neutral-500">
                        As of {fmtDate(item.asOf) || fmtDateTime(item.createdAt)}
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs ${recClass}`}>
                      {item.recommendation || "—"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-neutral-200">
                    <Stat label="Entry" value={fmtMoney(item.entryPrice)} helper={fmtDate(item.entryDate)} />
                    <Stat
                      label="Current (live)"
                      value={fmtMoney(item.livePrice)}
                      helper={item.liveReturnPct != null ? fmtPct(item.liveReturnPct) : "Awaiting live quote"}
                    />
                    <Stat
                      label="Stored price"
                      value={fmtMoney(item.currentPrice)}
                      helper={fmtDate(item.asOf) || fmtDateTime(item.createdAt)}
                    />
                    <Stat label="Fair Value" value={fmtMoney(item.fairValue)} />
                    <Stat label="Stop" value={fmtMoney(item.stopPrice)} />
                    <Stat label="Allocation" value={item.allocation != null ? `${item.allocation.toFixed(1)}%` : "—"} />
                  </div>

                  {item.notes && (
                    <div className="mt-3 text-sm text-neutral-300 bg-black/40 border border-neutral-800 rounded-xl p-3">
                      {item.notes}
                    </div>
                  )}

                  <div className="mt-3 text-[11px] text-neutral-400 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <span>
                        Source: {item.articleTitle ? item.articleTitle : "Newsletter"} •{" "}
                        {fmtDate(item.articleDate) || "N/A"}
                      </span>
                      {item.articleId && (
                        <button
                          type="button"
                          onClick={() => handleOpenArticle(item.articleId)}
                          className="text-[11px] underline text-neutral-300 hover:text-white"
                        >
                          View
                        </button>
                      )}
                    </span>
                    {hasOlder && (
                      <details className="ml-2">
                        <summary className="cursor-pointer text-[11px] text-neutral-300 hover:text-white">
                          History
                        </summary>
                        <div className="mt-2 space-y-2">
                          {hist.slice(1, 6).map((h) => (
                            <div key={h.id} className="rounded-lg border border-neutral-800 bg-black/40 p-2">
                              <div className="flex items-center justify-between text-xs text-neutral-300">
                                <span>{fmtDate(h.asOf)}</span>
                                <span className="px-2 py-0.5 rounded-full border border-neutral-700">
                                  {h.recommendation || "—"}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] text-neutral-400 flex gap-3">
                                <span>Entry {fmtMoney(h.entryPrice)}</span>
                                <span>Curr {fmtMoney(h.currentPrice)}</span>
                                <span>FV {fmtMoney(h.fairValue)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-neutral-800 my-4" />

        <section className="rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">Morningstar PDF FTVs</h3>
              <p className="text-xs text-neutral-400">
                Parsed from uploaded Morningstar PDFs; live prices overlay when available.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-3 rounded-xl border border-neutral-800 bg-black/30 px-3 py-2 text-neutral-300">
              Loading…
            </div>
          ) : !ftvLatest.length ? (
            <div className="mt-3 rounded-xl border border-neutral-800 bg-black/30 px-3 py-2 text-neutral-400">
              No Morningstar FTV data yet.
            </div>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {hydratedFtv.map((item) => {
                return (
                  <div
                    key={`${item.symbol}-${item.asOf}`}
                    className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-inner"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xl font-semibold tracking-wide">
                          {item.symbol}
                        </div>
                        <div className="text-xs text-neutral-500">
                          As of {fmtDate(item.asOf) || fmtDateTime(item.createdAt)}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs text-neutral-200 border-neutral-600 bg-black/60">
                        FTV
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-neutral-200">
                      <Stat
                        label="Current (live)"
                        value={fmtMoney(item.livePrice)}
                        helper={item.livePrice != null ? "" : "Awaiting live quote"}
                      />
                      <Stat label="Fair Value" value={fmtMoney(item.fairValue)} />
                      <Stat label="As of" value={fmtDate(item.asOf) || fmtDateTime(item.createdAt)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
      {helper && <div className="text-[11px] text-neutral-500">{helper}</div>}
    </div>
  );
}
