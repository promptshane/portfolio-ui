"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../components/header";
import type { DiscountPositionDto } from "@/types/discount";

type HubResponse = {
  ok: boolean;
  latest?: DiscountPositionDto[];
  history?: Record<string, DiscountPositionDto[]>;
  error?: string;
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
  BUY: "bg-[color:var(--good-500)/0.18] text-[var(--good-200)] border-[color:var(--good-500)/0.5]",
  HOLD: "bg-[color:var(--mid-500)/0.18] text-[var(--mid-100)] border-[color:var(--mid-500)/0.5]",
  SELL: "bg-[color:var(--bad-500)/0.18] text-[var(--bad-200)] border-[color:var(--bad-500)/0.5]",
};

const LIST_COUNTS = [10, 25, 50, 100];

export default function DiscountHubPage() {
  const [latest, setLatest] = useState<DiscountPositionDto[]>([]);
  const [history, setHistory] = useState<Record<string, DiscountPositionDto[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listCount, setListCount] = useState<number>(10);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch("/api/discounts", { cache: "no-store" });
        const data: HubResponse = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (aborted) return;
        setLatest(data.latest ?? []);
        setHistory(data.history ?? {});
      } catch (err: any) {
        if (!aborted) setError(err?.message || "Failed to load discount data.");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const tickerHighlights = useMemo(() => {
    return latest
      .map((item) => {
        const price = item.priceUsed ?? item.livePrice ?? item.currentPrice ?? null;
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
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => b.discountPct - a.discountPct);
  }, [latest]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Discount Hub" subtitle="Buy/Hold/Sell notes from recent issues" />

      <div className="space-y-4">
        <div className="bg-neutral-825 border border-neutral-800 rounded-2xl p-5 text-sm text-neutral-300">
          <p>
            We capture Buy/Hold/Sell grids from incoming research and surface the most recent call
            for each ticker. Older entries stay archived under each symbol for context.
          </p>
        </div>

        {/* Top discounts list */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">Most discounted tickers</h3>
              <p className="text-xs text-neutral-400">
                Live price (FMP) when available, otherwise article price. Sorted by discount vs FTV.
              </p>
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
                      <div className="text-sm font-semibold text-[var(--good-200)]">
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
            {latest.map((item) => {
              const recKey = (item.recommendation || "").toUpperCase();
              const recClass =
                recKey in badgeColors ? badgeColors[recKey] : "bg-black/60 text-neutral-200 border-neutral-600";
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
                      label="Current"
                      value={fmtMoney(item.priceUsed ?? item.livePrice ?? item.currentPrice)}
                      helper={fmtPct(item.liveReturnPct ?? item.returnPct)}
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
                    <span>
                      Source: {item.articleTitle ? item.articleTitle : "Newsletter"} •{" "}
                      {fmtDate(item.articleDate) || "N/A"}
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
