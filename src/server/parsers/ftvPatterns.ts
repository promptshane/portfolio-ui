/* Regex patterns and helpers to locate labeled values on page 1 (normalized text). */

export type RawFtvMatches = {
  fve?: { value?: string; index?: number; asOf?: string };
  priceFve?: { ratio?: string; index?: number };
  moat?: { value?: string; index?: number };
  styleBox?: { value?: string; index?: number };
  uncertainty?: { value?: string; index?: number };
  capitalAllocation?: { value?: string; index?: number };
  esg?: { score?: string; asOf?: string; index?: number };
};

/** Generic “As of …” date pattern: supports “Month DD, YYYY”, “YYYY-MM-DD”, “MM/DD/YYYY”. */
export const RE_AS_OF =
  /\bAs\s*of\s*(?:\:)?\s*(?<date>(?:[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/\d{2,4}))\b/i;

/** Fair Value Estimate money figure (captures $ with commas/decimals). */
export const RE_FVE =
  /\bFair\s*Value\s*Estimate\b[^$\d]{0,30}(?<amount>\$?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?)/i;

/** Price/Fair Value ratio (decimal like 0.75, 1.12, etc.). */
export const RE_PRICE_FV =
  /\bPrice\s*\/\s*Fair\s*Value\b[^0-9]{0,20}(?<ratio>\d+(?:\.\d+)?)/i;

/** Economic Moat label anchor. */
export const RE_MOAT_LABEL = /\bEconomic\s*Moat\b/i;

/** Economic Moat value (Wide|Narrow|None|No Moat; tolerant to unicode hyphens/spaces). */
export const RE_MOAT =
  /\bEconomic\s*Moat\b[^A-Za-z]{0,40}(?<moat>Wide|Narrow|None|No[\s\u00A0\u2010-\u2015-]*Moat)/i;

/** Equity Style Box (e.g., Large Blend/Core/Value/Growth; allow hyphens). */
export const RE_STYLE_BOX =
  /\b(?:Equity\s*)?Style\s*Box\b[^A-Za-z]{0,20}(?<style>(?:Large|Mid|Small)[-\s]+(?:Blend|Core|Value|Growth))/i;

/** Uncertainty rating (Low/Medium/High/Very High/Extreme). */
export const RE_UNCERTAINTY =
  /\bUncertainty\b[^A-Za-z]{0,20}(?<uncertainty>Low|Medium|High|Very\s*High|Extreme)/i;

/** Capital Allocation rating (Poor/Standard/Exemplary). */
export const RE_CAP_ALLOC =
  /\bCapital\s*Allocation\b[^A-Za-z]{0,20}(?<cap>Poor|Standard|Exemplary)/i;

/** ESG Risk Rating (numeric), allow optional “Assessment” label and punctuation noise nearby. */
export const RE_ESG =
  /\bESG\s*Risk\s*Rating(?:\s*Assessment)?\b[^0-9]{0,20}(?<score>\d{1,3}(?:\.\d+)?)/i;

/** Loose date (no "As of" required). Accepts:
 *  - DD Mon YYYY (optional time + UTC)
 *  - Month DD, YYYY
 *  - YYYY-MM-DD
 *  - MM/DD/YYYY
 */
export const RE_DATE_LOOSE =
  /\b(?<date>(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:,?\s*(?:UTC|[A-Z]{2,4}))?)?)|(?:[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/\d{2,4}))\b/i;

/** Ensure a regex is global for iterative scanning. */
function withGlobal(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
}

/** Remove invisible/odd glyphs that often appear between label and value. */
function cleanGlyphNoise(s: string): string {
  return s
    // zero-width + soft hyphen + NBSP
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, "")
    .replace(/\u00A0/g, " ")
    // bullets/dots that sometimes sit before values
    .replace(/[•▪●·]/g, " ")
    // collapse space noise
    .replace(/\s+/g, " ")
    .trim();
}

/** Find first match with index, returning group by name. */
function findFirst(
  text: string,
  re: RegExp,
  group: string
): { value: string; index: number } | null {
  const m = re.exec(text);
  if (!m) return null;
  const value = (m.groups?.[group] ?? m[1] ?? "").toString().trim();
  const index = typeof (m as any).index === "number" ? (m as any).index : text.indexOf(m[0]);
  return { value, index };
}

/** Scan within +/- window around an anchor index for an “As of …” date. */
function findAsOfNear(text: string, anchorIndex: number, window = 160): string | undefined {
  if (anchorIndex == null || anchorIndex < 0) return undefined;
  const start = Math.max(0, anchorIndex - window);
  const end = Math.min(text.length, anchorIndex + window);
  const slice = text.slice(start, end);
  const m = RE_AS_OF.exec(slice);
  if (!m) return undefined;
  const date = (m.groups?.date ?? "").toString().trim();
  return date || undefined;
}

/** Scan near an anchor for ANY recognizable date, preferring dates **after** the anchor. */
function findDateNearPreferAfter(text: string, anchorIndex: number, window = 260): string | undefined {
  if (anchorIndex == null || anchorIndex < 0) return undefined;

  const start = Math.max(0, anchorIndex - window);
  const end = Math.min(text.length, anchorIndex + window);
  const slice = text.slice(start, end);

  type Cand = { value: string; absIndex: number; dist: number };
  const cands: Cand[] = [];

  // Scan "As of ..." first
  const reA = withGlobal(RE_AS_OF);
  let mA: RegExpExecArray | null;
  while ((mA = reA.exec(slice))) {
    const value = (mA.groups?.date ?? "").toString().trim();
    if (!value) continue;
    const absIndex = start + (mA.index ?? slice.indexOf(mA[0]));
    const dist = absIndex - anchorIndex;
    cands.push({ value, absIndex, dist });
  }

  // Then loose dates
  const reL = withGlobal(RE_DATE_LOOSE);
  let mL: RegExpExecArray | null;
  while ((mL = reL.exec(slice))) {
    const value = (mL.groups?.date ?? "").toString().trim();
    if (!value) continue;
    const absIndex = start + (mL.index ?? slice.indexOf(mL[0]));
    const dist = absIndex - anchorIndex;
    cands.push({ value, absIndex, dist });
  }

  if (!cands.length) return undefined;

  // Prefer the closest date **after** the anchor; else closest overall.
  const after = cands.filter((c) => c.dist >= 0).sort((a, b) => a.dist - b.dist);
  if (after.length) return after[0].value;

  cands.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
  return cands[0].value;
}

/** Targeted moat extractor: anchor on label, clean glyph noise, then read value shortly after. */
function findMoatNear(text: string, lookahead = 180): { value: string; index: number } | null {
  const label = RE_MOAT_LABEL.exec(text);
  if (!label) return null;

  const anchorIndex = typeof (label as any).index === "number" ? (label as any).index : text.indexOf(label[0]);
  const start = anchorIndex;
  const end = Math.min(text.length, start + lookahead);

  const rawSlice = text.slice(start, end);
  const slice = cleanGlyphNoise(rawSlice);

  // Just the value within the cleaned slice
  const mVal = /\b(?<moat>Wide|Narrow|None|No\s*Moat)\b/i.exec(slice);
  if (!mVal?.groups?.moat) return null;

  // Best-effort absolute index: locate the matched value back in the raw slice.
  const rawIdxInSlice = rawSlice.search(new RegExp(mVal.groups.moat.replace(/\s+/g, "\\s+"), "i"));
  const absIndex = rawIdxInSlice >= 0 ? start + rawIdxInSlice : anchorIndex;

  return { value: mVal.groups.moat, index: absIndex };
}

/**
 * Extract raw, label-anchored values from normalized first-page text.
 * Postprocessing (numbers, canonical enums, ISO dates) is handled separately.
 */
export function matchFtvFields(normalizedText: string): RawFtvMatches {
  const t = normalizedText ?? "";

  // Fair Value Estimate
  const fve = findFirst(t, RE_FVE, "amount");
  // Prefer the FVE's own date (appears AFTER the amount); avoid header date.
  const fveAsOf = fve ? findDateNearPreferAfter(t, fve.index) : undefined;

  // Price/Fair Value
  const pfv = findFirst(t, RE_PRICE_FV, "ratio");

  // Moat (use targeted near-scan first; fall back to broad regex)
  const moatNear = findMoatNear(t);
  const moatBroad = moatNear ? null : findFirst(t, RE_MOAT, "moat");
  const moat = moatNear ?? moatBroad ?? null;

  // Style Box
  const style = findFirst(t, RE_STYLE_BOX, "style");

  // Uncertainty
  const unc = findFirst(t, RE_UNCERTAINTY, "uncertainty");

  // Capital Allocation
  const cap = findFirst(t, RE_CAP_ALLOC, "cap");

  // ESG Risk Rating (+ date near its label) — still prefer explicit "As of"
  const esg = findFirst(t, RE_ESG, "score");
  const esgAsOf = esg ? findAsOfNear(t, esg.index) : undefined;

  const out: RawFtvMatches = {};

  if (fve) out.fve = { value: fve.value, index: fve.index, asOf: fveAsOf };
  if (pfv) out.priceFve = { ratio: pfv.value, index: pfv.index };
  if (moat) out.moat = { value: moat.value, index: moat.index };
  if (style) out.styleBox = { value: style.value, index: style.index };
  if (unc) out.uncertainty = { value: unc.value, index: unc.index };
  if (cap) out.capitalAllocation = { value: cap.value, index: cap.index };
  if (esg) out.esg = { score: esg.value, asOf: esgAsOf, index: esg.index };

  return out;
}

export const PATTERNS = {
  RE_AS_OF,
  RE_DATE_LOOSE,
  RE_FVE,
  RE_PRICE_FV,
  RE_MOAT_LABEL,
  RE_MOAT,
  RE_STYLE_BOX,
  RE_UNCERTAINTY,
  RE_CAP_ALLOC,
  RE_ESG,
};
