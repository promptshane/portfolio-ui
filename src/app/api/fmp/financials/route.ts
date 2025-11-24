import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Avoid static optimization; always refetch fresh data
export const dynamic = "force-dynamic";

type Trio = { years: string[]; good: number[]; bad: number[]; net: number[] };

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function getApiKey(): string {
  const k = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!k) throw new Error("Missing FMP API key (FMP_API_KEY).");
  return k;
}

function normSym(sym: string) {
  return (sym || "").trim().toUpperCase();
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

function yearFrom(item: any): string | null {
  // Prefer calendarYear if available; else parse from date
  const y =
    (typeof item?.calendarYear === "string" && item.calendarYear) ||
    (typeof item?.calendarYear === "number" && String(item.calendarYear)) ||
    (typeof item?.date === "string" && item.date.slice(0, 4));
  return y && /^\d{4}$/.test(y) ? y : null;
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildTrioFromMaps(
  // maps: year -> value
  goodMap: Map<string, number>,
  badMap: Map<string, number>,
  netMap: Map<string, number>
): Trio {
  // Only keep years present in all three to avoid holes
  const years = Array.from(goodMap.keys())
    .filter((y) => badMap.has(y) && netMap.has(y))
    .map((y) => Number(y))
    .sort((a, b) => a - b)
    .map(String);

  return {
    years,
    good: years.map((y) => goodMap.get(y) ?? 0),
    bad: years.map((y) => badMap.get(y) ?? 0),
    net: years.map((y) => netMap.get(y) ?? 0),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = normSym(searchParams.get("symbol") || "");
    if (!symbol) return err("Missing symbol");
    const apikey = getApiKey();

    // FMP v3 endpoints (annual, latest-first, we’ll reverse). v3 is included on standard keys;
    // "stable" often requires higher tiers and can return legacy/forbidden errors.
    const base = "https://financialmodelingprep.com/api/v3";

    const incURL = `${base}/income-statement/${encodeURIComponent(
      symbol
    )}?period=annual&limit=8&apikey=${apikey}`;

    const balURL = `${base}/balance-sheet-statement/${encodeURIComponent(
      symbol
    )}?period=annual&limit=8&apikey=${apikey}`;

    const cfsURL = `${base}/cash-flow-statement/${encodeURIComponent(
      symbol
    )}?period=annual&limit=8&apikey=${apikey}`;

    const [incRaw, balRaw, cfsRaw] = await Promise.all([
      fetchJSON(incURL),
      fetchJSON(balURL),
      fetchJSON(cfsURL),
    ]);

    // Normalize arrays (some tickers may return objects or errors)
    const incArr: any[] = Array.isArray(incRaw) ? incRaw.slice() : [];
    const balArr: any[] = Array.isArray(balRaw) ? balRaw.slice() : [];
    const cfsArr: any[] = Array.isArray(cfsRaw) ? cfsRaw.slice() : [];

    // Reverse to oldest -> newest
    incArr.reverse();
    balArr.reverse();
    cfsArr.reverse();

    // Keep only last 5 years if more present
    const clip5 = <T,>(a: T[]) => (a.length > 5 ? a.slice(-5) : a);

    const inc = clip5(incArr);
    const bal = clip5(balArr);
    const cfs = clip5(cfsArr);

    // Build year->value maps
    const revMap = new Map<string, number>();
    const costMap = new Map<string, number>();
    const niMap = new Map<string, number>();

    for (const x of inc) {
      const y = yearFrom(x);
      if (!y) continue;
      const revenue = toNumber(x?.revenue);
      // cost fallbacks: costOfRevenue OR (revenue - grossProfit) if available
      let cost = toNumber(x?.costOfRevenue);
      if (cost === null) {
        const gp = toNumber(x?.grossProfit);
        if (revenue !== null && gp !== null) {
          const c = revenue - gp;
          cost = c < 0 ? 0 : c;
        }
      }
      const netIncome =
        toNumber(x?.netIncome) ??
        toNumber(x?.netIncomeApplicableToCommonShares);

      if (revenue !== null) revMap.set(y, revenue);
      if (cost !== null) costMap.set(y, Math.abs(cost));
      if (netIncome !== null) niMap.set(y, netIncome);
    }

    const assetsMap = new Map<string, number>();
    const liabMap = new Map<string, number>();
    const equityMap = new Map<string, number>();

    for (const x of bal) {
      const y = yearFrom(x);
      if (!y) continue;
      const assets = toNumber(x?.totalAssets);
      const liab = toNumber(x?.totalLiabilities);
      const equity =
        toNumber(x?.totalStockholdersEquity) ??
        toNumber(x?.totalEquity) ??
        toNumber(x?.totalShareholdersEquity);

      if (assets !== null) assetsMap.set(y, assets);
      if (liab !== null) liabMap.set(y, liab);
      if (equity !== null) equityMap.set(y, equity);
    }

    const opCFMap = new Map<string, number>();
    const capexAbsMap = new Map<string, number>();
    const fcfMap = new Map<string, number>();

    for (const x of cfs) {
      const y = yearFrom(x);
      if (!y) continue;
      const op =
        toNumber(x?.operatingCashFlow) ??
        toNumber(x?.netCashProvidedByOperatingActivities);
      const capexRaw = toNumber(x?.capitalExpenditure);
      // Normalize CapEx to positive spend (FMP commonly returns negative)
      const capexAbs = capexRaw === null ? null : Math.abs(capexRaw);
      const fcf = op !== null && capexAbs !== null ? op - capexAbs : null;

      if (op !== null) opCFMap.set(y, op);
      if (capexAbs !== null) capexAbsMap.set(y, capexAbs);
      if (fcf !== null) fcfMap.set(y, fcf);
    }

    // Build trios (years aligned within each statement set)
    const isTrio: Trio = buildTrioFromMaps(revMap, costMap, niMap);
    const bsTrio: Trio = buildTrioFromMaps(assetsMap, liabMap, equityMap);
    const cfsTrio: Trio = buildTrioFromMaps(opCFMap, capexAbsMap, fcfMap);

    const empty =
      isTrio.years.length === 0 &&
      bsTrio.years.length === 0 &&
      cfsTrio.years.length === 0;

    if (empty) {
      return NextResponse.json({
        ok: true,
        source: "fmp",
        symbol,
        is: { years: [], revenue: [], cost: [], net: [] },
        bs: { years: [], assets: [], liabilities: [], equity: [] },
        cfs: { years: [], op: [], capex: [], fcf: [] },
        note: "No 5Y annual data returned by FMP for this symbol.",
      });
    }

    // Return shape expected by evaluateStock() "Path A"
    return NextResponse.json({
      ok: true,
      source: "fmp",
      symbol,
      is: {
        years: isTrio.years,
        revenue: isTrio.good,
        cost: isTrio.bad,
        net: isTrio.net,
      },
      bs: {
        years: bsTrio.years,
        assets: bsTrio.good,
        liabilities: bsTrio.bad,
        equity: bsTrio.net,
      },
      cfs: {
        years: cfsTrio.years,
        op: cfsTrio.good,
        capex: cfsTrio.bad,
        fcf: cfsTrio.net,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Failed to fetch financials";
    return err(msg, 500);
  }
}
