import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://financialmodelingprep.com/stable";

function getApiKey(): string {
  const key = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) throw new Error("Missing FMP_API_KEY");
  return key;
}

function normSym(sym: string | null): string {
  return (sym || "").trim().toUpperCase();
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("FMP returned non-JSON payload");
  }
}

function pickLatest(rows: any[]): any | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ts = (r: any) => {
    const raw = r?.date ?? r?.calendarYear ?? r?.fiscalDate ?? null;
    const parsed = raw ? Date.parse(String(raw)) : NaN;
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  let best = rows[0];
  let bestTs = ts(best);
  for (const r of rows) {
    const t = ts(r);
    if (t > bestTs) {
      best = r;
      bestTs = t;
    }
  }
  return best;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = normSym(searchParams.get("symbol"));
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const key = getApiKey();

    const evURL = `${BASE}/enterprise-values?symbol=${encodeURIComponent(symbol)}&limit=4&apikey=${key}`;
    const incURL = `${BASE}/income-statement?symbol=${encodeURIComponent(
      symbol
    )}&period=annual&limit=1&apikey=${key}`;
    const balURL = `${BASE}/balance-sheet-statement?symbol=${encodeURIComponent(
      symbol
    )}&period=annual&limit=1&apikey=${key}`;
    const cfsURL = `${BASE}/cash-flow-statement?symbol=${encodeURIComponent(
      symbol
    )}&period=annual&limit=1&apikey=${key}`;
    const incTtmURL = `${BASE}/income-statements-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const cfsTtmURL = `${BASE}/cashflow-statements-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;

    const [evRes, incRes, balRes, cfsRes, incTtmRes, cfsTtmRes] = await Promise.allSettled([
      fetchJSON(evURL),
      fetchJSON(incURL),
      fetchJSON(balURL),
      fetchJSON(cfsURL),
      fetchJSON(incTtmURL),
      fetchJSON(cfsTtmURL),
    ]);

    const evRows = evRes.status === "fulfilled" ? evRes.value : [];
    const incRows = incRes.status === "fulfilled" ? incRes.value : [];
    const balRows = balRes.status === "fulfilled" ? balRes.value : [];
    const cfsRows = cfsRes.status === "fulfilled" ? cfsRes.value : [];
    const incTtmRows = incTtmRes.status === "fulfilled" ? incTtmRes.value : [];
    const cfsTtmRows = cfsTtmRes.status === "fulfilled" ? cfsTtmRes.value : [];

    const evRow = pickLatest(evRows);
    const incRow = pickLatest(incRows);
    const balRow = pickLatest(balRows);
    const cfsRow = pickLatest(cfsRows);
    const incTtmRow = pickLatest(incTtmRows);
    const cfsTtmRow = pickLatest(cfsTtmRows);
    const incSource = incTtmRow ?? incRow;
    const cfsSource = cfsTtmRow ?? cfsRow;

    const metrics: Record<string, number> = {};

    const enterpriseValue = toNum(evRow?.enterpriseValue ?? evRow?.enterprisevalue);
    if (enterpriseValue !== null) metrics.enterpriseValue = enterpriseValue;

    const evDebt =
      toNum(evRow?.addTotalDebt ?? evRow?.totalDebt ?? evRow?.netDebt) ??
      null;
    const evCash =
      toNum(evRow?.cashAndCashEquivalents ?? evRow?.minusCashAndCashEquivalents) ??
      null;

    const balCash =
      toNum(balRow?.cashAndCashEquivalents) ??
      toNum(balRow?.cashAndShortTermInvestments) ??
      null;
    const balDebt = (() => {
      const total = toNum(balRow?.totalDebt);
      if (total !== null) return total;
      const lt = toNum(balRow?.longTermDebt ?? balRow?.longTermDebtNoncurrent);
      const st = toNum(balRow?.shortTermDebt ?? balRow?.currentDebt);
      if (lt !== null || st !== null) return (lt ?? 0) + (st ?? 0);
      return null;
    })();

    const totalDebt = evDebt ?? balDebt;
    const cashAndCashEquivalents = evCash ?? balCash;

    if (totalDebt !== null) metrics.totalDebt = totalDebt;
    if (cashAndCashEquivalents !== null) metrics.cashAndCashEquivalents = cashAndCashEquivalents;

    const netDebtFromEV = toNum(evRow?.netDebt);
    const netDebt =
      netDebtFromEV !== null
        ? netDebtFromEV
        : totalDebt !== null && cashAndCashEquivalents !== null
        ? totalDebt - cashAndCashEquivalents
        : null;
    if (netDebt !== null) metrics.netDebt = netDebt;

    const revenue = toNum(incSource?.revenue);
    const netIncome = toNum(
      incSource?.netIncome ??
        incSource?.netIncomeApplicableToCommonShares ??
        incSource?.netIncomeCommonStockholders
    );
    if (revenue !== null) metrics.revenue = revenue;
    if (netIncome !== null) metrics.netIncome = netIncome;
    const ebitda = toNum(incSource?.ebitda ?? incSource?.EBITDA);
    if (ebitda !== null) metrics.ebitda = ebitda;
    if (ebitda !== null && revenue) {
      const margin = revenue === 0 ? null : ebitda / revenue;
      if (margin !== null) metrics.ebitdaMargin = margin;
    }

    const operatingIncome = toNum(incSource?.operatingIncome ?? incSource?.operatingIncomeLoss);
    if (operatingIncome !== null) {
      metrics.operatingIncome = operatingIncome;
      metrics.ebit = operatingIncome;
    }
    if (operatingIncome !== null && revenue) {
      const margin = revenue === 0 ? null : operatingIncome / revenue;
      if (margin !== null) metrics.operatingMargin = margin;
    }

    const interestExpenseRaw = toNum(
      incSource?.interestExpense ??
        incSource?.interestExpenseNonOperating ??
        incSource?.interestAndDebtExpense
    );
    const interestExpense = interestExpenseRaw !== null ? Math.abs(interestExpenseRaw) : null;
    if (interestExpense !== null) metrics.interestExpense = interestExpense;
    if (operatingIncome !== null && interestExpense !== null && interestExpense !== 0) {
      const coverage = operatingIncome / interestExpense;
      if (Number.isFinite(coverage)) metrics.interestCoverage = coverage;
    }

    const opCash =
      toNum(cfsSource?.operatingCashFlow ?? cfsSource?.netCashProvidedByOperatingActivities) ?? null;
    if (opCash !== null) metrics.operatingCashFlow = opCash;

    const capexRaw = toNum(cfsSource?.capitalExpenditure);
    if (capexRaw !== null) metrics.capitalExpenditure = capexRaw;

    const fcfFromRow = toNum(cfsSource?.freeCashFlow);
    const fcf =
      fcfFromRow !== null
        ? fcfFromRow
        : opCash !== null && capexRaw !== null
        ? opCash + capexRaw
        : null;
    if (fcf !== null) metrics.freeCashFlow = fcf;

    if (opCash !== null && revenue) {
      const cfoMargin = revenue === 0 ? null : opCash / revenue;
      if (cfoMargin !== null) metrics.operatingCashFlowSalesRatio = cfoMargin;
    }
    if (fcf !== null && revenue) {
      const fcfMargin = revenue === 0 ? null : fcf / revenue;
      if (fcfMargin !== null) metrics.freeCashFlowSalesRatio = fcfMargin;
    }
    if (opCash !== null && netIncome !== null && netIncome !== 0) {
      const ratio = opCash / netIncome;
      if (Number.isFinite(ratio)) metrics.operatingCashFlowNetIncomeRatio = ratio;
    }
    if (fcf !== null && netIncome !== null && netIncome !== 0) {
      const ratio = fcf / netIncome;
      if (Number.isFinite(ratio)) metrics.freeCashFlowNetIncomeRatio = ratio;
    }

    const repurchasesRaw = toNum(cfsSource?.commonStockRepurchased);
    const issuanceRaw = toNum(cfsSource?.commonStockIssued);
    const dividendsRaw = toNum(cfsSource?.dividendsPaid ?? cfsSource?.dividendPayments);

    if (repurchasesRaw !== null) metrics.shareRepurchases = Math.abs(repurchasesRaw);
    if (dividendsRaw !== null) metrics.dividendsPaid = Math.abs(dividendsRaw);
    if (repurchasesRaw !== null || issuanceRaw !== null) {
      const net = (repurchasesRaw ?? 0) + (issuanceRaw ?? 0);
      if (Number.isFinite(net)) metrics.netBuybacks = net;
    }

    if (netDebt !== null && ebitda) {
      const ratio = ebitda === 0 ? null : netDebt / ebitda;
      if (ratio !== null && Number.isFinite(ratio)) metrics.netDebtToEbitda = ratio;
    }

    const hasAny = Object.values(metrics).some((v) => Number.isFinite(v as number));
    if (!hasAny) throw new Error("No metrics returned from FMP.");

    return NextResponse.json({ ok: true, metrics });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "FMP financial metrics error" },
      { status: 500 }
    );
  }
}
