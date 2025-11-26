// src/app/analysis/sections/FTVDisplay.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { EvalResult, dotClass, FtvDocMeta } from "../shared";
import { getFTVData } from "../calc/ftvCalc";
import FTVTiles from "./FTVTiles";
import type { DiscountPositionDto } from "@/types/discount";

type Props = { result: EvalResult };

export default function FTVDisplay({ result }: Props) {
  // ---------------- Dev controls + metadata ----------------
  const [isDev, setIsDev] = useState(false);
  const [latest, setLatest] = useState<FtvDocMeta | undefined>(undefined); // Morningstar / uploaded PDF
  const [discountLatest, setDiscountLatest] = useState<DiscountPositionDto | null>(null); // Discount Hub FTV fallback
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [discountErr, setDiscountErr] = useState<string | null>(null);
  const [docsLoaded, setDocsLoaded] = useState(false); // track fetch completion to avoid flicker
  const [esgOverride, setEsgOverride] = useState<{
    risk: number | null;
    category: string | null;
    asOf: string | null;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const sym = result.sym;

  async function fetchDocs() {
    try {
      setDocsLoaded(false);
      setErr(null);
      const res = await fetch(`/api/ftv/docs?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to fetch FTV docs");
      }
      setLatest(data.latest);
    } catch (e: any) {
      setErr(e?.message || "Failed to load FTV docs");
      setLatest(undefined);
    } finally {
      setDocsLoaded(true);
    }
  }

  useEffect(() => {
    fetchDocs();
    setDiscountLatest(null);
    setEsgOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  async function fetchDiscount() {
    try {
      setDiscountErr(null);
      const res = await fetch(`/api/discounts/${encodeURIComponent(sym)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to fetch discount hub data");
      }
      setDiscountLatest(data.latest ?? null);
    } catch (e: any) {
      setDiscountErr(e?.message || "Failed to load discount hub data");
      setDiscountLatest(null);
    }
  }

  useEffect(() => {
    fetchDiscount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  async function handleDevAuth() {
    const password = window.prompt("Enter developer password:");
    if (!password) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/ftv/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Unauthorized");
      }
      setIsDev(true);
    } catch (e: any) {
      setIsDev(false);
      setErr(e?.message || "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!sym) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ftv/docs?symbol=${encodeURIComponent(sym)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Confirm failed");
      setLatest(data.latest);
      setIsDev(false);
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    if (!file) return;
    setLoading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("symbol", sym.toUpperCase());
      fd.append("file", file);
      const res = await fetch("/api/ftv/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Upload failed");
      setLatest(data.latest);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ---------------- Existing FTV chart data (for fallback) ----------------
  const d = getFTVData(result);

  const pathFrom = (vals: number[]) => {
    const pad = d.pad, w = d.w, h = d.h;
    const all = [...d.upper, ...d.lower, ...d.priceTail, ...d.fv];
    const min = Math.min(...all), max = Math.max(...all);
    const sx = (w - 2 * pad) / Math.max(1, d.n - 1);
    const sy = max === min ? 1 : (h - 2 * pad) / (max - min);
    const X = (i: number) => pad + i * sx;
    const Y = (v: number) => h - pad - (v - min) * sy;

    let p = `M ${X(0)} ${Y(vals[0])}`;
    for (let i = 1; i < vals.length; i++) p += ` L ${X(i)} ${Y(vals[i])}`;
    return { p, X, Y, min, max };
  };

  const center = pathFrom(d.fv);
  const price = pathFrom(d.priceTail);
  const upper = pathFrom(d.upper);
  const lower = pathFrom(d.lower);

  const leftX = d.pad, rightX = d.w - d.pad;
  const areaUnderPrice = `${price.p} L ${rightX} ${d.botY} L ${leftX} ${d.botY} Z`;
  const areaAbovePrice = `${price.p} L ${rightX} ${d.topY} L ${leftX} ${d.topY} Z`;
  const areaAboveUpper = `${upper.p} L ${rightX} ${d.topY} L ${leftX} ${d.topY} Z`;
  const areaBelowLower = `${lower.p} L ${rightX} ${d.botY} L ${leftX} ${d.botY} Z`;

  let bandPoly = `M ${upper.X(0)} ${upper.Y(d.upper[0])}`;
  for (let i = 1; i < d.n; i++) bandPoly += ` L ${upper.X(i)} ${upper.Y(d.upper[i])}`;
  for (let i = d.n - 1; i >= 0; i--) bandPoly += ` L ${lower.X(i)} ${lower.Y(d.lower[i])}`;
  bandPoly += " Z";

  // Fallback FVE for tiles if the PDF hasn't been parsed for FVE yet
  const fallbackFve =
    Array.isArray(d.fv) && d.fv.length ? d.fv[d.fv.length - 1] : undefined;

  const parseDateSafe = (val?: string | null) => {
    if (!val) return null;
    const t = Date.parse(val);
    return Number.isNaN(t) ? null : new Date(t);
  };

  const pdfAsOf = parseDateSafe(latest?.ftvAsOf ?? latest?.confirmedAt ?? latest?.uploadedAt ?? null);
  const discountAsOf = parseDateSafe(discountLatest?.asOf ?? discountLatest?.createdAt ?? null);
  const discountHasFtv = discountLatest?.fairValue != null;

  const preferDiscount =
    discountHasFtv &&
    (!latest || !latest.ftvEstimate || !pdfAsOf || (discountAsOf && pdfAsOf && discountAsOf > pdfAsOf));

  // Build the active FTV meta based on source preference (discount hub vs PDF)
  const activeMeta: FtvDocMeta | undefined = (() => {
    if (preferDiscount && discountLatest) {
      return {
        symbol: sym,
        url: "",
        uploadedAt: discountLatest.asOf || discountLatest.createdAt || new Date().toISOString(),
        ftvEstimate: discountLatest.fairValue ?? undefined,
        ftvAsOf: discountLatest.asOf || discountLatest.createdAt || undefined,
        moat: undefined,
        styleBox: undefined,
        uncertainty: undefined,
        capitalAllocation: undefined,
        esgRisk: esgOverride?.risk ?? undefined,
        esgAsOf: esgOverride?.asOf ?? undefined,
        esgCategory: esgOverride?.category ?? undefined,
        parseVersion: undefined,
        parsedAt: undefined,
        confirmedAt: undefined,
      };
    }
    return latest;
  })();

  // Fetch ESG (FMP) only when we are using Discount Hub FTV
  useEffect(() => {
    let cancelled = false;
    if (!preferDiscount) {
      setEsgOverride(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/fmp/esg?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || data?.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        const risk =
          typeof data.esgRisk === "number"
            ? data.esgRisk
            : data.esgRisk != null && !Number.isNaN(Number(data.esgRisk))
            ? Number(data.esgRisk)
            : null;
        setEsgOverride({
          risk,
          category: data.esgCategory ?? null,
          asOf: data.asOf ?? null,
        });
      } catch (e) {
        if (!cancelled) {
          setEsgOverride(null);
          console.warn("ESG fetch failed", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preferDiscount, sym]);

  // ---------------- New price-vs-FVE graph data ----------------
  const parsedFve = activeMeta?.ftvEstimate ?? undefined;
  const parsedAsOf = activeMeta?.ftvAsOf ?? activeMeta?.uploadedAt ?? undefined;

  const allDates = result.series?.dates ?? [];
  const allPrices = result.series?.price ?? [];
  const hasSeries = allDates.length && allPrices.length && allDates.length === allPrices.length;

  const parseISO = (s?: string) => {
    if (!s) return undefined;
    const t = Date.parse(s);
    return Number.isNaN(t) ? undefined : new Date(t);
  };

  let sliceStart = 0;
  if (parsedAsOf && hasSeries) {
    const asOfDt = parseISO(parsedAsOf);
    if (asOfDt) {
      for (let i = 0; i < allDates.length; i++) {
        const dt = parseISO(allDates[i]);
        if (dt && dt.getTime() >= asOfDt.getTime()) {
          sliceStart = i;
          break;
        }
      }
    }
  }

  const dates = hasSeries ? allDates.slice(sliceStart) : [];
  const prices = hasSeries ? allPrices.slice(sliceStart) : [];

  // Scaling for the new graph
  const W = 1000, H = 200, PAD = 10;
  const fve = parsedFve ?? fallbackFve;
  const scaleVals = fve !== undefined ? [...prices, fve] : prices;
  const minV = scaleVals.length ? Math.min(...scaleVals) : 0;
  const maxV = scaleVals.length ? Math.max(...scaleVals) : 1;
  const nPts = prices.length;
  const sx = (W - 2 * PAD) / Math.max(1, nPts - 1);
  const sy = maxV === minV ? 1 : (H - 2 * PAD) / (maxV - minV);
  const Xn = (i: number) => PAD + i * sx;
  const Yn = (v: number) => H - PAD - (v - minV) * sy;

  // Build price path
  const pricePath = (() => {
    if (!nPts) return "";
    let p = `M ${Xn(0)} ${Yn(prices[0])}`;
    for (let i = 1; i < nPts; i++) p += ` L ${Xn(i)} ${Yn(prices[i])}`;
    return p;
  })();

  // Build area polygons relative to price (for intersection shading)
  const topY = PAD;
  const botY = H - PAD;
  const areaAbovePriceNew = nPts
    ? `${pricePath} L ${Xn(nPts - 1)} ${topY} L ${Xn(0)} ${topY} Z`
    : "";
  const areaBelowPriceNew = nPts
    ? `${pricePath} L ${Xn(nPts - 1)} ${botY} L ${Xn(0)} ${botY} Z`
    : "";

  // Crosshair state (only for new graph mode)
  const [hover, setHover] = useState<{ show: boolean; xi: number; x: number; y: number }>({
    show: false,
    xi: 0,
    x: 0,
    y: 0,
  });

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!nPts) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;

    const rawIdx = Math.round((px - PAD) / Math.max(1e-6, sx));
    const xi = Math.max(0, Math.min(nPts - 1, rawIdx));
    const x = Xn(xi);
    const y = Yn(prices[xi]);
    setHover({ show: true, xi, x, y });
  };

  const handleLeave = () => setHover((h) => ({ ...h, show: false }));

  // IDs for clipPaths (unique per symbol to avoid collisions)
  const clipAboveId = `clipAboveFVE_${sym}`;
  const clipBelowId = `clipBelowFVE_${sym}`;

  // -------- Hover details to forward to tiles (price, date, tone) --------
  const hoverPrice =
    parsedFve !== undefined && hasSeries && hover.show ? prices[hover.xi] : undefined;
  const hoverDate =
    parsedFve !== undefined && hasSeries && hover.show ? dates[hover.xi] : undefined;

  const toneFromRatio = (ratio?: number): "good" | "bad" | "mid" | undefined => {
    if (ratio == null || !Number.isFinite(ratio)) return undefined;
    if (ratio < 0.95) return "good";
    if (ratio > 1.05) return "bad";
    return "mid";
  };

  const summaryRatio = hoverPrice && hover.show ? hoverPrice / fve! : fve && Number.isFinite(result.price) ? result.price / fve : undefined;
  const summaryTone = toneFromRatio(summaryRatio);

  const hoverTone =
    hoverPrice !== undefined && fve !== undefined && hover.show
      ? toneFromRatio(hoverPrice / fve)
      : undefined;

  // Decide fallback rendering AFTER hooks are declared to keep hook order stable
  const showFallback = docsLoaded && !activeMeta && fallbackFve === undefined && !preferDiscount;
  const fallbackSuffix = activeMeta?.confirmedAt
    ? ` (confirmed ${new Date(activeMeta.confirmedAt).toLocaleString()})`
    : activeMeta
    ? " (unconfirmed)"
    : "";

  return (
    <>
      {showFallback ? (
        // Minimal replacement UI (no header, dev controls, graph, or tiles)
        <div className="bg-neutral-800 rounded-2xl p-6 border border-neutral-700 text-center text-neutral-300">
          {"No FTV Info" + fallbackSuffix}
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700 flex items-center justify-between">
            <div className="font-medium">FTV Summary</div>

            <div className="flex items-center gap-3">
              {activeMeta && (
                <div className="text-xs text-neutral-300 hidden sm:block">
                  <span className="mr-3">
                    {preferDiscount ? "Discount Hub as of" : "Last upload:"}{" "}
                    <span className="text-neutral-100">
                      {activeMeta.uploadedAt ? new Date(activeMeta.uploadedAt).toLocaleString() : "—"}
                    </span>
                  </span>
                  {activeMeta.confirmedAt && (
                    <span>
                      Confirmed:{" "}
                      <span className="text-neutral-100">
                        {new Date(activeMeta.confirmedAt).toLocaleString()}
                      </span>
                    </span>
                  )}
                  {!preferDiscount && !activeMeta?.confirmedAt && (
                    <span className="ml-2 text-neutral-400">(unconfirmed)</span>
                  )}
                  {preferDiscount && (
                    <span className="ml-2 text-[var(--good-200)]">
                      Using Discount Hub FTV
                    </span>
                  )}
                  {discountErr && (
                    <span className="ml-2 text-[var(--bad-300)]">
                      ({discountErr})
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                {latest?.url && (
                  <a
                    href={latest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-neutral-200 hover:text-white"
                    title="View latest uploaded PDF"
                  >
                    View latest PDF
                  </a>
                )}

                <div
                  role="button"
                  tabIndex={0}
                  onClick={handleDevAuth}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? handleDevAuth() : undefined)}
                  className={`w-5 h-5 rounded-full border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)] cursor-pointer ${
                    summaryTone
                      ? summaryTone === "good"
                        ? "bg-[var(--good-500)]"
                        : summaryTone === "mid"
                        ? "bg-[var(--mid-400)]"
                        : "bg-[var(--bad-500)]"
                      : dotClass(result.ftvScore)
                  } ${loading ? "opacity-70" : ""}`}
                  title={isDev ? "Developer mode enabled" : "Click to enter developer mode"}
                />
              </div>
            </div>
          </div>

          {/* Dev controls */}
          {isDev && (
            <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700 -mt-3 mb-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm"
                  title="Upload Morningstar (or other) analysis PDF"
                >
                  Upload Document
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleConfirm}
                  className="px-3 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm"
                  title="Confirm that the latest uploaded PDF reflects the current analysis"
                >
                  Confirm Updated
                </button>
                {loading && <span className="text-xs text-neutral-400">Working…</span>}
                {err && <span className="text-xs text-[var(--bad-400)]">{err}</span>}
              </div>
            </div>
          )}

          {/* Graph */}
          <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700">
            {parsedFve !== undefined && hasSeries ? (
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-[180px]"
                preserveAspectRatio="none"
                onMouseMove={handleMove}
                onMouseLeave={handleLeave}
              >
                <defs>
                  <clipPath id={clipAboveId}>
                    <rect x="0" y="0" width={W} height={fve !== undefined ? Yn(fve) : 0} />
                  </clipPath>
                  <clipPath id={clipBelowId}>
                    <rect
                      x="0"
                      y={fve !== undefined ? Yn(fve) : 0}
                      width={W}
                      height={fve !== undefined ? H - Yn(fve) : H}
                    />
                  </clipPath>
                </defs>

                {/* ±5% band */}
                {fve !== undefined && (
                  <>
                    {(() => {
                      const yUpper = Yn(fve * 1.05);
                      const yLower = Yn(fve * 0.95);
                      const bandPath = `M ${PAD} ${yUpper} L ${W - PAD} ${yUpper} L ${W - PAD} ${yLower} L ${PAD} ${yLower} Z`;
                      return (
                        <>
                          <path d={bandPath} fill="var(--mid-400)" fillOpacity="0.14" />
                          <line x1={PAD} y1={yUpper} x2={W - PAD} y2={yUpper} stroke="var(--mid-400)" strokeWidth={1.2} />
                          <line x1={PAD} y1={yLower} x2={W - PAD} y2={yLower} stroke="var(--mid-400)" strokeWidth={1.2} />
                        </>
                      );
                    })()}
                  </>
                )}

                {/* Shaded area between price and FVE */}
                {areaAbovePriceNew && (
                  <g clipPath={`url(#${clipBelowId})`}>
                    <path d={areaAbovePriceNew} fill="var(--good-500)" fillOpacity="0.22" />
                  </g>
                )}
                {areaBelowPriceNew && (
                  <g clipPath={`url(#${clipAboveId})`}>
                    <path d={areaBelowPriceNew} fill="var(--bad-500)" fillOpacity="0.22" />
                  </g>
                )}

                {/* Flat FVE line */}
                {fve !== undefined && (
                  <path
                    d={`M ${PAD} ${Yn(fve)} L ${W - PAD} ${Yn(fve)}`}
                    stroke="var(--mid-400)"
                    strokeDasharray="4 4"
                    strokeWidth={1.4}
                    fill="none"
                  />
                )}

                {/* Price path, colored by position relative to FVE */}
                <g clipPath={`url(#${clipAboveId})`}>
                  <path
                    d={pricePath}
                    fill="none"
                    stroke="var(--bad-500)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
                <g clipPath={`url(#${clipBelowId})`}>
                  <path
                    d={pricePath}
                    fill="none"
                    stroke="var(--good-500)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>

                {hover.show && (
                  <>
                    <line x1={hover.x} y1={PAD} x2={hover.x} y2={H - PAD} stroke="#9ca3af" strokeOpacity="0.6" strokeWidth={1} />
                    <line x1={PAD} y1={hover.y} x2={W - PAD} y2={hover.y} stroke="#9ca3af" strokeOpacity="0.4" strokeWidth={1} />
                  </>
                )}

                <rect x="0" y="0" width={W} height={H} fill="transparent" />
              </svg>
            ) : (
              <svg viewBox="0 0 1000 200" className="w-full h-[180px]" preserveAspectRatio="none">
                <defs>
                  <clipPath id="clipAboveUpper"><path d={areaAboveUpper} /></clipPath>
                  <clipPath id="clipBelowLower"><path d={areaBelowLower} /></clipPath>
                </defs>
                <path d={bandPoly} fill="var(--mid-400)" fillOpacity="0.14" />
                <path d={upper.p}  fill="none" stroke="var(--mid-400)" strokeWidth={1.2} />
                <path d={lower.p}  fill="none" stroke="var(--mid-400)" strokeWidth={1.2} />
                <path d={center.p} fill="none" stroke="var(--mid-400)" strokeDasharray="4 4" strokeWidth={1.2} />
                <g clipPath="url(#clipAboveUpper)">
                  <path d={areaUnderPrice} fill="var(--bad-500)" fillOpacity="0.22" />
                </g>
                <g clipPath="url(#clipBelowLower)">
                  <path d={areaAbovePrice} fill="var(--good-500)" fillOpacity="0.22" />
                </g>
                <path d={price.p} fill="none" stroke="#e5e7eb" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            )}
          </div>

          {/* FTV tiles */}
          {activeMeta ? (
            <FTVTiles
              result={result}
              latest={activeMeta}
              fallbackFve={fallbackFve}
              hoverInfo={{
                price: hoverPrice,
                date: hoverDate,
                tone: hoverTone,
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
