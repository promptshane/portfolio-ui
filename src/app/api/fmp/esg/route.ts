import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type EsgRecord = {
  totalEsg?: number;
  esgScore?: number;
  esgRiskScore?: number;
  riskScore?: number;
  rating?: string;
  date?: string;
  publishingDate?: string;
};

function parseEsgCategory(score: number): string {
  if (score < 10) return "Negligible";
  if (score < 20) return "Low";
  if (score < 30) return "Medium";
  if (score < 40) return "High";
  return "Severe";
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  const key = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Missing FMP_API_KEY" }, { status: 500 });
  }

  const url = `https://financialmodelingprep.com/api/v4/esg-environmental-social-governance-data?symbol=${encodeURIComponent(
    symbol
  )}&limit=1&apikey=${key}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`FMP ESG HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("FMP ESG returned non-JSON");
    }

    if (!Array.isArray(json) || !json.length) {
      return NextResponse.json({ ok: true, esgRisk: null, esgCategory: null, asOf: null });
    }

    const rec: EsgRecord = json[0];
    const score =
      rec.totalEsg ??
      rec.esgScore ??
      rec.esgRiskScore ??
      rec.riskScore ??
      null;

    const asOf = rec.date || rec.publishingDate || null;
    const esgCategory = typeof score === "number" ? parseEsgCategory(score) : rec.rating || null;

    return NextResponse.json({
      ok: true,
      esgRisk: score,
      esgCategory,
      asOf,
    });
  } catch (err: any) {
    console.error("FMP ESG fetch failed", err);
    return NextResponse.json({ error: err?.message || "FMP ESG fetch failed" }, { status: 500 });
  }
}
