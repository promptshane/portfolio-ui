// src/app/api/market/history/[symbol]/route.ts
import { NextResponse } from "next/server";
import {
  fetchDailyHistory,
  fetchWeeklyHistory,
  fetchIntraday5MinHistory,
  fetchIntraday1HourHistory,
} from "@/app/lib/fmp-history";

export const dynamic = "force-dynamic"; // ensure fresh fetch; no static caching

type IntervalKind = "daily" | "weekly" | "5min" | "1hour";

function normalizeInterval(raw: string | null): IntervalKind {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return "daily";

  // weekly / long-range
  if (v === "weekly" || v === "week" || v === "1w" || v === "1wk") return "weekly";

  // intraday
  if (v === "5min" || v === "5m" || v === "intraday" || v === "intraday5min") return "5min";
  if (
    v === "1hour" ||
    v === "1h" ||
    v === "hour" ||
    v === "60min" ||
    v === "intraday1hour" ||
    v === "intraday_1h" ||
    v === "1w_intraday"
  )
    return "1hour";

  // explicit daily aliases (IMPORTANT: do NOT treat "1d" as intraday)
  if (v === "daily" || v === "day" || v === "1d") return "daily";

  return "daily";
}

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
): Promise<ReturnType<typeof NextResponse.json>> {
  try {
    const sym = (params?.symbol || "").trim().toUpperCase();
    if (!sym) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const url = new URL(req.url);
    const interval = normalizeInterval(url.searchParams.get("interval"));

    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    const hasValidLimit =
      typeof limit === "number" && Number.isFinite(limit) && limit > 0;

    let series: any[] = [];

    if (interval === "weekly") {
      series = await fetchWeeklyHistory(sym);
    } else if (interval === "5min") {
      series = await fetchIntraday5MinHistory(sym, hasValidLimit ? { limit } : {});
    } else if (interval === "1hour") {
      series = await fetchIntraday1HourHistory(sym, hasValidLimit ? { limit } : {});
    } else {
      series = await fetchDailyHistory(sym);
    }

    // For daily/weekly only, apply limit on server (intraday already requests a tailored limit)
    if (hasValidLimit && (interval === "daily" || interval === "weekly")) {
      if (series.length > limit!) series = series.slice(series.length - limit!);
    }

    // Normalize so downstream always has `close` numeric (adjClose fallback),
    // while preserving other fields.
    series = (series || []).map((p: any) => {
      const closeNum = Number(p?.close ?? p?.adjClose);
      return {
        ...p,
        close: Number.isFinite(closeNum) ? closeNum : p?.close,
        adjClose: p?.adjClose != null ? Number(p.adjClose) : p?.adjClose,
        volume: p?.volume ?? null,
      };
    });

    return NextResponse.json({
      symbol: sym,
      interval,
      count: series.length,
      series, // always includes { date, close }, plus adjClose/volume when available
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
