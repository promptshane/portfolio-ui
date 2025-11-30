// src/app/analysis/sections/FTVTiles.tsx
"use client";

import type { EvalResult, FtvDocMeta } from "../shared";

export type FTVTilesProps = {
  result: EvalResult;
  latest: FtvDocMeta;
  /** Optional fallback FVE if the PDF didn’t include ftvEstimate yet. */
  fallbackFve?: number;

  /** Hover details from the graph (optional). */
  hoverInfo?: {
    price?: number;
    date?: string | Date;
    tone?: "good" | "bad" | "mid"; // ignored; we recompute from band
  };
};

/* ---------- format helpers ---------- */
function formatCurrency(n: number | undefined | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  return n >= 1000
    ? `$${Math.round(n).toLocaleString()}`
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Treat bare YYYY-MM-DD as UTC to avoid local-tz backshift (1-day lag)
function formatDate(s?: string) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { timeZone: "UTC" });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}
function formatDateAny(d?: string | Date) {
  if (!d) return "";
  if (typeof d === "string") return formatDate(d);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

/* ---------- Tile primitives ---------- */
function Tile(props: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`rounded-xl border p-4 bg-transparent ${props.className ?? ""}`} style={props.style}>
      <div className="text-sm opacity-75">{props.title}</div>
      <div className="mt-1 text-xl font-semibold">{props.value}</div>
      {props.sub ? <div className="mt-1 text-sm opacity-75">{props.sub}</div> : null}
    </div>
  );
}

function StarTile(props: { className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border px-3 py-2 bg-transparent ${props.className ?? ""}`} style={props.style}>
      {props.children ?? null}
    </div>
  );
}

/* ---------- tiny star bar (inline SVG, uses currentColor) ---------- */
function StarBar({
  filled,
  total,
  className,
  style,
}: {
  filled: number;
  total: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const stars = Array.from({ length: total });
  return (
    <div className={`flex justify-center gap-3 ${className ?? ""}`} style={style}>
      {stars.map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill={i < filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          className="shrink-0"
          aria-hidden
        >
          <path d="M12 2.5l2.9 5.89 6.5.95-4.7 4.58 1.11 6.48L12 17.9l-5.81 3.5 1.11-6.48-4.7-4.58 6.5-.95L12 2.5z" />
        </svg>
      ))}
    </div>
  );
}

/* ---------- color helpers ---------- */
function borderGood() { return "border-[var(--good-400)]"; }
function borderMid()  { return "border-[var(--mid-400)]"; }
function borderBad()  { return "border-[var(--bad-400)]"; }

function textGood() { return "text-[var(--good-400)]"; }
function textMid()  { return "text-[var(--mid-400)]"; }
function textBad()  { return "text-[var(--bad-400)]"; }

function textTone(t?: "good" | "bad" | "mid") {
  if (t === "good") return textGood();
  if (t === "bad")  return textBad();
  return textMid();
}

/* ---------- legacy fallbacks (used only if star mapping absent) ---------- */
function borderForUncertaintyLegacy(val?: string) {
  const s = (val || "").toLowerCase();
  if (!s) return borderMid();
  if (s.includes("extreme") || s.includes("very high")) return borderBad();
  if (s.includes("high")) return borderBad();
  if (s.includes("medium")) return borderMid();
  if (s.includes("low")) return borderGood();
  return borderMid();
}
function borderForCapAllocLegacy(val?: string) {
  const s = (val || "").toLowerCase();
  if (!s) return borderMid();
  if (s.includes("exemplary")) return borderGood();
  if (s.includes("poor")) return borderBad();
  if (s.includes("standard")) return borderMid();
  return borderMid();
}
function borderForMoatLegacy(val?: string) {
  const s = (val || "").toLowerCase();
  if (!s) return borderMid();
  if (s.includes("wide")) return borderGood();
  if (s.includes("narrow")) return borderMid();
  if (s.includes("none") || s.includes("no moat")) return borderBad();
  return borderMid();
}
function borderForEsgCategoryLegacy(cat?: string) {
  const s = (cat || "").toLowerCase();
  if (!s) return borderMid();
  if (s.includes("negligible")) return borderGood();
  if (s.includes("low")) return borderGood();
  if (s.includes("medium")) return borderMid();
  if (s.includes("high")) return borderBad();
  if (s.includes("severe")) return borderBad();
  return borderMid();
}

/* ---------- stars mapping helpers (all out of 5) ---------- */
function starsForEsg(cat?: string): { filled: number; total: number } | null {
  const s = (cat || "").toLowerCase();
  if (!s) return null;
  if (s.includes("negligible")) return { filled: 5, total: 5 };
  if (s.includes("low"))         return { filled: 4, total: 5 };
  if (s.includes("medium"))      return { filled: 3, total: 5 };
  if (s.includes("high"))        return { filled: 2, total: 5 };
  if (s.includes("severe"))      return { filled: 1, total: 5 };
  return null;
}
function starsForMoat(val?: string): { filled: number; total: number } | null {
  const s = (val || "").toLowerCase();
  if (!s) return null;
  if (s.includes("wide"))   return { filled: 5, total: 5 };
  if (s.includes("narrow")) return { filled: 3, total: 5 };
  if (s.includes("none") || s.includes("no moat")) return { filled: 1, total: 5 };
  return null;
}
function starsForUncertainty(val?: string): { filled: number; total: number } | null {
  const s = (val || "").toLowerCase();
  if (!s) return null;
  if (s.includes("low"))       return { filled: 5, total: 5 };
  if (s.includes("medium"))    return { filled: 3, total: 5 }; // 3★ = mid
  if (s.includes("high"))      return { filled: 2, total: 5 };
  if (s.includes("very high")) return { filled: 1, total: 5 };
  if (s.includes("extreme"))   return { filled: 1, total: 5 };
  return null;
}
function starsForCapAlloc(val?: string): { filled: number; total: number } | null {
  const s = (val || "").toLowerCase();
  if (!s) return null;
  if (s.includes("exemplary")) return { filled: 5, total: 5 };
  if (s.includes("standard"))  return { filled: 3, total: 5 };
  if (s.includes("poor"))      return { filled: 1, total: 5 };
  return null;
}

/* ---------- FVE stars from price/FVE ratio (±5% = 3★) ---------- */
const MID_LOW = 0.95;  // -5%
const MID_HIGH = 1.05; // +5%

function toneFromRatio(r?: number): "good" | "bad" | "mid" | undefined {
  if (r === undefined || !isFinite(r)) return undefined;
  if (r < MID_LOW) return "good";
  if (r > MID_HIGH) return "bad";
  return "mid";
}
function starsForFveRatio(r?: number): { filled: number; total: number } | null {
  if (r === undefined || !isFinite(r)) return null;
  if (r <= 0.85)  return { filled: 5, total: 5 };      // ≥15% discount
  if (r < 0.95)   return { filled: 4, total: 5 };      // 5–15% discount
  if (r <= 1.05)  return { filled: 3, total: 5 };      // within ±5%
  if (r < 1.15)   return { filled: 2, total: 5 };      // 5–15% premium
  return { filled: 1, total: 5 };                      // ≥15% premium
}

/* ---------- star-tone + consistent colors (NO border thickness changes) ---------- */
type ToneMix = "bad" | "mid" | "good" | "bad-mid" | "mid-good";

function starToneFromCount(filled: number): ToneMix {
  if (filled <= 1) return "bad";        // 1★
  if (filled === 2) return "bad-mid";   // 2★
  if (filled === 3) return "mid";       // 3★
  if (filled === 4) return "mid-good";  // 4★
  return "good";                        // 5★
}

function mixColor(aVar: string, bVar: string, pctA = 50) {
  return `color-mix(in srgb, var(${aVar}) ${pctA}%, var(${bVar}) ${100 - pctA}%)`;
}

function borderClassAndStyleFromTone(t: ToneMix): { className: string; style?: React.CSSProperties } {
  // Constant border width to avoid vertical layout shifts.
  switch (t) {
    case "bad":      return { className: borderBad() };
    case "mid":      return { className: borderMid() };
    case "good":     return { className: borderGood() };
    case "bad-mid":  return { className: "", style: { borderColor: mixColor("--bad-400", "--mid-400") } };
    case "mid-good": return { className: "", style: { borderColor: mixColor("--mid-400", "--good-400") } };
  }
}

function textClassAndStyleFromTone(t: ToneMix): { className?: string; style?: React.CSSProperties } {
  switch (t) {
    case "bad":      return { className: textBad() };
    case "mid":      return { className: textMid() };
    case "good":     return { className: textGood() };
    case "bad-mid":  return { style: { color: mixColor("--bad-400", "--mid-400") } };
    case "mid-good": return { style: { color: mixColor("--mid-400", "--good-400") } };
  }
}

/** Reuse same grid template for both rows so stars align under their tiles. */
const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

/**
 * FTV tiles + a second row of star tiles aligned beneath each box.
 */
export default function FTVTiles({ result, latest, fallbackFve, hoverInfo }: FTVTilesProps) {
  const price = Number.isFinite(result.price) ? result.price : undefined;

  const fve = latest.ftvEstimate ?? fallbackFve;

  const fveDate = latest.ftvAsOf ?? latest.uploadedAt;

  const activePrice = hoverInfo?.price ?? price;
  const ratio = fve && activePrice ? activePrice / fve : undefined;
  const overUnder = fve && activePrice ? (activePrice - fve) / fve : undefined;

  const ratioTone: "good" | "bad" | "mid" | undefined = toneFromRatio(ratio);
  const discountMeta =
    typeof overUnder === "number"
      ? overUnder < 0
        ? { label: "Discount", pct: Math.abs(overUnder * 100) }
        : overUnder > 0
        ? { label: "Premium", pct: Math.abs(overUnder * 100) }
        : { label: "At FVE", pct: 0 }
      : null;

  const moat = latest.moat ?? "-";
  // Style Box remains parsed on `latest.styleBox` but is intentionally not rendered for now.
  const uncertainty = latest.uncertainty ?? "-";
  const capAlloc = latest.capitalAllocation ?? "-";
  const esgRisk = latest.esgRisk;
  const esgAsOf = latest.esgAsOf;
  const esgCategory = latest.esgCategory;

  // Star ratings
  const fveStars  = starsForFveRatio(ratio);
  const esgStars  = starsForEsg(esgCategory);
  const moatStars = starsForMoat(moat);
  const uncStars  = starsForUncertainty(uncertainty);
  const capStars  = starsForCapAlloc(capAlloc);

  // Tones derived from star counts (drives BOTH rows)
  const fveTone  : ToneMix = fveStars  ? starToneFromCount(fveStars.filled)  : "mid";
  const esgTone  : ToneMix = esgStars  ? starToneFromCount(esgStars.filled)  : "mid";
  const moatTone : ToneMix = moatStars ? starToneFromCount(moatStars.filled) : "mid";
  const uncTone  : ToneMix = uncStars  ? starToneFromCount(uncStars.filled)  : "mid";
  const capTone  : ToneMix = capStars  ? starToneFromCount(capStars.filled)  : "mid";

  // Borders (top + bottom) from tones; constant thickness to avoid jumping
  const fveBorderTop   = borderClassAndStyleFromTone(fveTone);
  const esgBorderTop   = esgStars ? borderClassAndStyleFromTone(esgTone)  : { className: borderForEsgCategoryLegacy(esgCategory) };
  const moatBorderTop  = moatStars ? borderClassAndStyleFromTone(moatTone) : { className: borderForMoatLegacy(moat) };
  const uncBorderTop   = uncStars ? borderClassAndStyleFromTone(uncTone)  : { className: borderForUncertaintyLegacy(uncertainty) };
  const capBorderTop   = capStars ? borderClassAndStyleFromTone(capTone)  : { className: borderForCapAllocLegacy(capAlloc) };

  const fveBorderBottom  = fveBorderTop;
  const esgBorderBottom  = esgBorderTop;
  const moatBorderBottom = moatBorderTop;
  const uncBorderBottom  = uncBorderTop;
  const capBorderBottom  = capBorderTop;

  // Text color for star bars
  const fveTextTone   = textClassAndStyleFromTone(fveTone);
  const esgTextTone   = textClassAndStyleFromTone(esgTone);
  const moatTextTone  = textClassAndStyleFromTone(moatTone);
  const uncTextTone   = textClassAndStyleFromTone(uncTone);
  const capTextTone   = textClassAndStyleFromTone(capTone);

  const ratioToneClass = textTone(ratioTone);

  const hoverPriceEl =
    hoverInfo?.price !== undefined ? (
      <span className={`ml-2 text-sm ${ratioToneClass}`}>({formatCurrency(hoverInfo.price)})</span>
    ) : null;

  const hoverDateEl =
    hoverInfo?.date ? (
      <span className={`ml-1 ${ratioToneClass}`}>({formatDateAny(hoverInfo.date)})</span>
    ) : null;

  // ESG value "<value> <category>" if both; else numeric; else em-dash.
  const hasEsgRisk = esgRisk !== null && esgRisk !== undefined && !Number.isNaN(Number(esgRisk));
  const formatEsgScore = (n: number) => {
    const fixed = Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
    return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  };
  const esgValue: React.ReactNode = hasEsgRisk
    ? esgCategory
      ? `${formatEsgScore(Number(esgRisk))} ${esgCategory}`
      : formatEsgScore(Number(esgRisk))
    : esgCategory || "-";

  return (
    <>
      {/* Top row: data tiles */}
      <div className={`mt-4 ${GRID}`}>
        {/* 1) FVE */}
        <Tile
          title="FTV Estimate"
          className={fveBorderTop.className}
          style={fveBorderTop.style}
          value={
            <>
              {formatCurrency(fve)}
              {hoverPriceEl}
            </>
          }
          sub={
            <div className="flex flex-col">
              <span>
                {fveDate ? `As of ${formatDate(fveDate)}` : ""}
                {hoverDateEl}
              </span>
              <span className="mt-1">
                {discountMeta ? (
                  discountMeta.label === "At FVE" ? (
                    "At Fair Value"
                  ) : (
                    <>
                      {discountMeta.label}:{" "}
                      <strong className={ratioToneClass}>{discountMeta.pct.toFixed(0)}%</strong>
                    </>
                  )
                ) : (
                  "—"
                )}
              </span>
            </div>
          }
        />

        {/* 2) ESG */}
        <Tile
          title="ESG Risk Rating"
          className={esgBorderTop.className}
          style={esgBorderTop.style}
          value={esgValue}
          sub={esgAsOf ? `As of ${formatDate(esgAsOf)}` : undefined}
        />

        {/* 3) Moat */}
        <Tile title="Economic Moat" value={moat} className={moatBorderTop.className} style={moatBorderTop.style} />

        {/* 4) Uncertainty */}
        <Tile title="Uncertainty" value={uncertainty} className={uncBorderTop.className} style={uncBorderTop.style} />

        {/* 5) Capital Allocation */}
        <Tile title="Capital Allocation" value={capAlloc} className={capBorderTop.className} style={capBorderTop.style} />

      </div>

      {/* Bottom row: star tiles aligned 1:1 with the top row */}
      <div className={`mt-1 ${GRID}`}>
        {/* Under FVE */}
        <StarTile className={fveBorderBottom.className} style={fveBorderBottom.style}>
          {fveStars ? (
            <StarBar
              filled={fveStars.filled}
              total={5}
              className={fveTextTone.className}
              style={fveTextTone.style}
            />
          ) : null}
        </StarTile>

        {/* Under ESG */}
        <StarTile className={esgBorderBottom.className} style={esgBorderBottom.style}>
          {esgStars ? (
            <StarBar
              filled={esgStars.filled}
              total={5}
              className={esgTextTone.className}
              style={esgTextTone.style}
            />
          ) : null}
        </StarTile>

        {/* Under Moat */}
        <StarTile className={moatBorderBottom.className} style={moatBorderBottom.style}>
          {moatStars ? (
            <StarBar
              filled={moatStars.filled}
              total={5}
              className={moatTextTone.className}
              style={moatTextTone.style}
            />
          ) : null}
        </StarTile>

        {/* Under Uncertainty */}
        <StarTile className={uncBorderBottom.className} style={uncBorderBottom.style}>
          {uncStars ? (
            <StarBar
              filled={uncStars.filled}
              total={5}
              className={uncTextTone.className}
              style={uncTextTone.style}
            />
          ) : null}
        </StarTile>

        {/* Under Capital Allocation */}
        <StarTile className={capBorderBottom.className} style={capBorderBottom.style}>
          {capStars ? (
            <StarBar
              filled={capStars.filled}
              total={5}
              className={capTextTone.className}
              style={capTextTone.style}
            />
          ) : null}
        </StarTile>

      </div>
    </>
  );
}
