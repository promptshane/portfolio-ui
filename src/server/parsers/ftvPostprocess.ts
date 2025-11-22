/* Postprocessing: convert raw regex groups into typed, canonical fields. */

import type { RawFtvMatches } from "./ftvPatterns";

export type FtvPostprocessed = {
  ftvEstimate?: number;                 // Morningstar Fair Value Estimate (USD)
  ftvAsOf?: string;                     // ISO date (YYYY-MM-DD)
  moat?: "Wide" | "Narrow" | "None" | string;
  styleBox?: string;                    // e.g., "Large Blend"
  uncertainty?: "Low" | "Medium" | "High" | "Very High" | "Extreme" | string;
  capitalAllocation?: "Poor" | "Standard" | "Exemplary" | string;
  esgRisk?: number;                     // numeric score
  esgAsOf?: string;                     // ISO date (YYYY-MM-DD)
};

/* ------------------------- helpers ------------------------- */

function toNumberCurrency(input?: string): number | undefined {
  if (!input) return undefined;
  // keep digits, dot, and minus; drop $ and commas/spaces
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return undefined;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function toNumber(input?: string): number | undefined {
  if (!input) return undefined;
  const n = Number.parseFloat(input.trim());
  return Number.isFinite(n) ? n : undefined;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Parse common date shapes into ISO YYYY-MM-DD.
 *  Supports:
 *   - "YYYY-MM-DD"
 *   - "MM/DD/YYYY" (or M/D/YY)
 *   - "Month DD, YYYY"
 *   - "DD Mon YYYY" with optional "HH:MM(:SS) ,? (UTC|TZ)" suffix
 */
function toIsoDate(input?: string): string | undefined {
  if (!input) return undefined;
  const s = input.trim();

  // YYYY-MM-DD
  {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // MM/DD/YYYY or M/D/YY(YY)
  {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) {
      const mo = Number(m[1]), d = Number(m[2]);
      let y = Number(m[3]);
      if (y < 100) y += y >= 70 ? 1900 : 2000; // naive century inference
      if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // Month DD, YYYY
  {
    const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
    if (m) {
      const moStr = m[1].toLowerCase();
      const mo = MONTHS[moStr];
      const d = Number(m[2]);
      const y = Number(m[3]);
      if (mo && d >= 1 && d <= 31) return `${y}-${mo}-${pad2(d)}`;
    }
  }

  // DD Mon YYYY [HH:MM[:SS] [,] (UTC|TZ)]
  {
    const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:,?\s*(?:UTC|[A-Z]{2,4}))?)?$/i.exec(
      s.replace(/\s+/g, " ").replace(/\u00A0/g, " ")
    );
    if (m) {
      const d = Number(m[1]);
      const mo = MONTHS[m[2].toLowerCase()];
      const y = Number(m[3]);
      if (mo && d >= 1 && d <= 31) return `${y}-${mo}-${pad2(d)}`;
    }
  }

  // Fallback: try Date.parse (last resort)
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const mo = pad2(dt.getMonth() + 1);
    const d = pad2(dt.getDate());
    return `${y}-${mo}-${d}`;
  }
  return undefined;
}

function canonicalMoat(input?: string): "Wide" | "Narrow" | "None" | string | undefined {
  if (!input) return undefined;
  const s = input.toLowerCase().replace(/\s+/g, "");
  if (s === "wide") return "Wide";
  if (s === "narrow") return "Narrow";
  if (s === "none" || s === "nomoat") return "None";
  return titleCase(input);
}

function canonicalUncertainty(input?: string): "Low" | "Medium" | "High" | "Very High" | "Extreme" | string | undefined {
  if (!input) return undefined;
  const s = input.toLowerCase().replace(/\s+/g, "");
  if (s === "low") return "Low";
  if (s === "medium") return "Medium";
  if (s === "high") return "High";
  if (s === "veryhigh") return "Very High";
  if (s === "extreme") return "Extreme";
  return titleCase(input);
}

function canonicalCapAlloc(input?: string): "Poor" | "Standard" | "Exemplary" | string | undefined {
  if (!input) return undefined;
  const s = input.toLowerCase();
  if (s.includes("poor")) return "Poor";
  if (s.includes("standard")) return "Standard";
  if (s.includes("exemplary")) return "Exemplary";
  return titleCase(input);
}

function canonicalStyleBox(input?: string): string | undefined {
  if (!input) return undefined;
  const s = input.replace(/[-]+/g, " ").replace(/\s+/g, " ").trim();
  // Normalize common tokens
  const parts = s.split(" ").map(titleCase);
  // Keep "Large/Mid/Small" + "Blend/Core/Value/Growth"
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return titleCase(s);
}

/* ------------------------- main ------------------------- */

/**
 * Convert raw regex groups into typed values with light canonicalization.
 * This does not require any external context (e.g., current price).
 */
export function postprocessRawMatches(raw: RawFtvMatches): FtvPostprocessed {
  const out: FtvPostprocessed = {};

  // FVE (money) + "As of"/loose date
  if (raw.fve?.value) out.ftvEstimate = toNumberCurrency(raw.fve.value);
  if (raw.fve?.asOf) out.ftvAsOf = toIsoDate(raw.fve.asOf);

  // Moat
  if (raw.moat?.value) out.moat = canonicalMoat(raw.moat.value);

  // Style Box
  if (raw.styleBox?.value) out.styleBox = canonicalStyleBox(raw.styleBox.value);

  // Uncertainty
  if (raw.uncertainty?.value) out.uncertainty = canonicalUncertainty(raw.uncertainty.value);

  // Capital Allocation
  if (raw.capitalAllocation?.value) out.capitalAllocation = canonicalCapAlloc(raw.capitalAllocation.value);

  // ESG Risk (+ date)
  if (raw.esg?.score) out.esgRisk = toNumber(raw.esg.score);
  if (raw.esg?.asOf) out.esgAsOf = toIsoDate(raw.esg.asOf);

  // Note: raw.priceFve.ratio is intentionally ignored here (cross-check only).
  return out;
}

export default postprocessRawMatches;
