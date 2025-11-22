// src/app/api/market/quotes/route.ts
import { NextResponse } from "next/server";
import { fetchQuotes } from "../../../lib/fmp";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const symbols = (sp.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "No symbols provided" }, { status: 400 });
  }

  try {
    const data = await fetchQuotes(symbols);
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error("[quotes route error]", msg);
    return NextResponse.json(
      { ok: false, error: process.env.NODE_ENV === "production" ? "Failed to fetch quotes" : msg },
      { status: 500 }
    );
  }
}