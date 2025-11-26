"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../components/header";

type Purchase = { id: string; label: string; age: number; amount: number };

type ForecastPoint = { age: number; value: number };

function uuid() {
  return Math.random().toString(36).slice(2, 9);
}

function parseNum(value: string | number, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(n: number) {
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function calcForecast({
  currentAge,
  retirementAge,
  endAge,
  salary,
  savePct,
  growthPct,
  currentAssets,
  purchases,
}: {
  currentAge: number;
  retirementAge: number;
  endAge: number;
  salary: number;
  savePct: number;
  growthPct: number;
  currentAssets: number;
  purchases: Purchase[];
}): { baseline: ForecastPoint[]; withPurchases: ForecastPoint[] } {
  const g = growthPct / 100;
  const saveAnnual = salary * (savePct / 100);

  const sortedPurchases = purchases.slice().sort((a, b) => a.age - b.age);

  const baseline: ForecastPoint[] = [];
  const withPurchases: ForecastPoint[] = [];

  let base = currentAssets;
  let alt = currentAssets;

  for (let age = currentAge; age <= endAge; age++) {
    if (age < retirementAge) {
      base = (base + saveAnnual) * (1 + g);
      alt = (alt + saveAnnual) * (1 + g);
    } else {
      base = base * (1 + g);
      alt = alt * (1 + g);
    }

    // apply purchases at this age on the alternative track
    for (const p of sortedPurchases) {
      if (p.age === age) {
        alt = Math.max(0, alt - p.amount);
      }
    }

    baseline.push({ age, value: base });
    withPurchases.push({ age, value: alt });
  }

  return { baseline, withPurchases };
}

function calcSafeWithdrawals(value: number, ratePct: number, years: number) {
  const r = ratePct / 100;
  if (r === 0 || years <= 0) return value / Math.max(1, years * 12);
  const monthlyRate = r / 12;
  // Simple amortization style draw
  const denom = (1 - Math.pow(1 + monthlyRate, -years * 12)) / monthlyRate;
  return denom ? value / denom : value / (years * 12);
}

export default function RetirementPage() {
  const [birthday, setBirthday] = useState<string>("");
  const [retAge, setRetAge] = useState(65);
  const [endAge, setEndAge] = useState(90);
  const [salary, setSalary] = useState(120_000);
  const [savePct, setSavePct] = useState(15);
  const [growthPct, setGrowthPct] = useState(6);
  const [startAssets, setStartAssets] = useState<number>(50_000);
  const [withdrawRate, setWithdrawRate] = useState(4);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedDob = window.localStorage.getItem("retirement:birthday");
      if (storedDob) setBirthday(storedDob);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (birthday) {
      try {
        window.localStorage.setItem("retirement:birthday", birthday);
      } catch {
        /* ignore */
      }
    }
  }, [birthday]);

  // Seed starting assets from portfolio holdings (best-effort)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPortfolio(true);
      setPortfolioError(null);
      try {
        const res = await fetch("/api/portfolio", { cache: "no-store" });
        const data = await res.json();
        const items: { sym: string; shares: number }[] = Array.isArray(data?.items) ? data.items : [];
        const syms = Array.from(new Set(items.map((i) => (i.sym || "").toUpperCase()).filter(Boolean)));
        if (!syms.length) return;

        const quoteRes = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(syms.join(","))}`, {
          cache: "no-store",
        });
        if (!quoteRes.ok) throw new Error("Failed to fetch quotes");
        const quoteData = await quoteRes.json();
        const bySym = quoteData?.data ?? {};
        let total = 0;
        for (const h of items) {
          const sym = (h.sym || "").toUpperCase();
          const px = Number(bySym[sym]?.price);
          if (Number.isFinite(px)) {
            total += px * Number(h.shares || 0);
          }
        }
        if (!cancelled && total > 0) setStartAssets(Math.round(total));
      } catch (err: any) {
        if (!cancelled) setPortfolioError(err?.message || "Portfolio lookup failed");
      } finally {
        if (!cancelled) setLoadingPortfolio(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const age = useMemo(() => {
    if (!birthday) return 30;
    const d = new Date(birthday);
    if (Number.isNaN(d.getTime())) return 30;
    const diff = Date.now() - d.getTime();
    return Math.max(0, Math.floor(diff / (365.25 * 24 * 3600 * 1000)));
  }, [birthday]);

  const forecast = useMemo(
    () =>
      calcForecast({
        currentAge: age,
        retirementAge: retAge,
        endAge,
        salary,
        savePct,
        growthPct,
        currentAssets: startAssets,
        purchases,
      }),
    [age, retAge, endAge, salary, savePct, growthPct, startAssets, purchases]
  );

  const withdrawalMonthly = useMemo(() => {
    const horizon = Math.max(1, endAge - retAge);
    const nestEggAtRet = forecast.withPurchases.find((p) => p.age === retAge)?.value ?? startAssets;
    return calcSafeWithdrawals(nestEggAtRet, withdrawRate, horizon);
  }, [forecast.withPurchases, retAge, endAge, withdrawRate, startAssets]);

  const maxVal = Math.max(
    ...forecast.baseline.map((p) => p.value),
    ...forecast.withPurchases.map((p) => p.value),
    startAssets
  );

  const chartW = 900;
  const chartH = 260;
  const pad = 12;
  const years = forecast.baseline.length ? forecast.baseline[forecast.baseline.length - 1].age - age : 1;
  const scaleX = (a: number) => pad + ((a - age) / Math.max(1, years)) * (chartW - 2 * pad);
  const scaleY = (v: number) => chartH - pad - (v / Math.max(1, maxVal || 1)) * (chartH - 2 * pad);

  const toPath = (points: ForecastPoint[]) => {
    if (!points.length) return "";
    return points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${scaleX(p.age)} ${scaleY(p.value)}`)
      .join(" ");
  };

  const baselinePath = toPath(forecast.baseline);
  const altPath = toPath(forecast.withPurchases);

  const addPurchase = () => {
    setPurchases((prev) => [...prev, { id: uuid(), label: "Big purchase", age: retAge - 5, amount: 50_000 }]);
  };

  const updatePurchase = (id: string, field: keyof Purchase, value: string) => {
    setPurchases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: field === "label" ? value : parseNum(value, p[field] as any) } : p))
    );
  };

  const removePurchase = (id: string) => {
    setPurchases((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Retirement" subtitle="Project your future wealth and explore trade-offs" />

      <div className="space-y-5">
        <section className="bg-neutral-800 rounded-2xl border border-neutral-700 p-5 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Birthday</label>
              <input
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Retirement age</label>
              <input
                type="number"
                value={retAge}
                onChange={(e) => setRetAge(parseNum(e.target.value, retAge))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-24"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">End age</label>
              <input
                type="number"
                value={endAge}
                onChange={(e) => setEndAge(parseNum(e.target.value, endAge))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-24"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Current salary</label>
              <input
                type="number"
                value={salary}
                onChange={(e) => setSalary(parseNum(e.target.value, salary))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-32"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Save %</label>
              <input
                type="number"
                value={savePct}
                onChange={(e) => setSavePct(parseNum(e.target.value, savePct))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-20"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Growth %</label>
              <input
                type="number"
                value={growthPct}
                onChange={(e) => setGrowthPct(parseNum(e.target.value, growthPct))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-20"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Current assets</label>
              <input
                type="number"
                value={startAssets}
                onChange={(e) => setStartAssets(parseNum(e.target.value, startAssets))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-32"
              />
              <span className="text-[11px] text-neutral-500 mt-1">
                {loadingPortfolio ? "Syncing portfolio…" : portfolioError ? portfolioError : "Seeded from portfolio when available"}
              </span>
            </div>
          </div>
        </section>

        <section className="bg-neutral-800 rounded-2xl border border-neutral-700 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Forecast</h3>
              <p className="text-xs text-neutral-400">Baseline vs. with purchases</p>
            </div>
            <div className="text-sm text-neutral-300">
              Projected monthly withdrawal at retirement:{" "}
              <span className="font-semibold text-[var(--highlight-100)]">
                {formatMoney(withdrawalMonthly)}
              </span>
              <span className="text-neutral-500 ml-1">(assuming {withdrawRate}% rule)</span>
            </div>
          </div>

          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-[240px]">
            <rect x={0} y={0} width={chartW} height={chartH} fill="transparent" />
            {baselinePath && (
              <path d={baselinePath} stroke="var(--mid-300)" strokeWidth={2} fill="none" />
            )}
            {altPath && <path d={altPath} stroke="var(--good-400)" strokeWidth={2} fill="none" />}
            {forecast.baseline.map((p, idx) => (
              <g key={idx}>
                <circle cx={scaleX(p.age)} cy={scaleY(p.value)} r={2} fill="var(--mid-200)" />
                <circle
                  cx={scaleX(p.age)}
                  cy={scaleY(forecast.withPurchases[idx]?.value ?? 0)}
                  r={2}
                  fill="var(--good-300)"
                />
              </g>
            ))}
            {/* Axes */}
            <line x1={pad} y1={chartH - pad} x2={chartW - pad} y2={chartH - pad} stroke="#4b5563" strokeWidth={1} />
            <line x1={pad} y1={pad} x2={pad} y2={chartH - pad} stroke="#4b5563" strokeWidth={1} />
          </svg>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-xl border border-neutral-700 bg-black/30 p-3">
              <div className="text-xs text-neutral-500">Balance at {retAge}</div>
              <div className="text-lg font-semibold text-white">
                {formatMoney(forecast.withPurchases.find((p) => p.age === retAge)?.value ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border border-neutral-700 bg-black/30 p-3">
              <div className="text-xs text-neutral-500">Balance at {endAge}</div>
              <div className="text-lg font-semibold text-white">
                {formatMoney(forecast.withPurchases.find((p) => p.age === endAge)?.value ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border border-neutral-700 bg-black/30 p-3">
              <div className="text-xs text-neutral-500">Monthly draw</div>
              <div className="text-lg font-semibold text-white">{formatMoney(withdrawalMonthly)}</div>
            </div>
            <div className="rounded-xl border border-neutral-700 bg-black/30 p-3">
              <div className="text-xs text-neutral-500">Assumed growth</div>
              <div className="text-lg font-semibold text-white">{growthPct}%</div>
            </div>
          </div>
        </section>

        <section className="bg-neutral-800 rounded-2xl border border-neutral-700 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Purchases & What-ifs</h3>
              <p className="text-xs text-neutral-400">
                Add major purchases to see how they affect your path.
              </p>
            </div>
            <button
              type="button"
              onClick={addPurchase}
              className="rounded-lg border border-[var(--highlight-400)] px-3 py-1.5 text-sm text-[var(--highlight-100)]"
            >
              Add purchase
            </button>
          </div>

          {purchases.length === 0 ? (
            <p className="text-sm text-neutral-400">No purchases yet.</p>
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center bg-black/30 border border-neutral-700 rounded-xl p-3"
                >
                  <input
                    type="text"
                    value={p.label}
                    onChange={(e) => updatePurchase(p.id, "label", e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    placeholder="Label"
                  />
                  <input
                    type="number"
                    value={p.age}
                    onChange={(e) => updatePurchase(p.id, "age", e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    placeholder="Age"
                  />
                    <input
                    type="number"
                    value={p.amount}
                    onChange={(e) => updatePurchase(p.id, "amount", e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    placeholder="Amount"
                  />
                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removePurchase(p.id)}
                      className="text-sm text-red-300 hover:text-red-100"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-neutral-800 rounded-2xl border border-neutral-700 p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h3 className="text-lg font-semibold">Withdrawal assumptions</h3>
              <p className="text-xs text-neutral-400">Plan how much you can pull each month.</p>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-400 mb-1">Withdrawal rate %</label>
              <input
                type="number"
                value={withdrawRate}
                onChange={(e) => setWithdrawRate(parseNum(e.target.value, withdrawRate))}
                className="rounded-lg border border-neutral-600 bg-black/40 px-3 py-2 text-sm w-24"
              />
            </div>
          </div>
          <p className="text-sm text-neutral-300">
            Based on your assumptions, you could withdraw{" "}
            <span className="font-semibold text-[var(--highlight-100)]">{formatMoney(withdrawalMonthly)}</span> per
            month from ages {retAge} to {endAge}.
          </p>
        </section>
      </div>
    </main>
  );
}
