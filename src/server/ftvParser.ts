// src/server/ftvParser.ts
// Facade for parsing FTV-relevant fields from a PDF (first page only) + ESG add-on.

import { extractFirstPageText, /* to be added */ extractAllText } from "./parsers/pdfExtract";
import { matchFtvFields } from "./parsers/ftvPatterns";
import postprocessRawMatches, { FtvPostprocessed } from "./parsers/ftvPostprocess";

export const CURRENT_PARSE_VERSION = "2025-11-01-esg-v1";

export type EsgParsed = Partial<{
  esgRisk: number;                                // e.g., 13.4
  esgCategory: "Negligible" | "Low" | "Medium" | "High" | "Severe";
  esgAsOf?: string;                               // e.g., "Sep 03, 2025"
  esgChunkRaw: string;                            // compact raw slice where the score was seen
}>;

export type ParsedFtvMeta = FtvPostprocessed & EsgParsed & {
  parseVersion: string;
  parsedAt: string; // ISO timestamp
};

/**
 * parseFtvPdf
 * Input: PDF bytes (Buffer/Uint8Array/ArrayBuffer)
 * Output: typed, optional fields ready to persist into FtvDocMeta,
 *         plus parseVersion/parsedAt for auto-reparse checks.
 */
export async function parseFtvPdf(
  input: Buffer | Uint8Array | ArrayBuffer
): Promise<ParsedFtvMeta> {
  // ---------- Existing FTV first-page pipeline ----------
  const { normalized } = await extractFirstPageText(input);
  const raw = matchFtvFields(normalized);
  const meta = postprocessRawMatches(raw);

  // ---------- ESG (document-scope, rule-based) ----------
  const esg = await parseEsgFromPdf(input);

  return {
    ...meta,
    ...esg,
    parseVersion: CURRENT_PARSE_VERSION,
    parsedAt: new Date().toISOString(),
  };
}

export default parseFtvPdf;

// ============================================================================
// ESG parsing (rule-based, mirrors the working mini-app behavior)
// ============================================================================

/** Normalize whitespace for predictable regex behavior. */
function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Anchors: prefer literal "Assessment5", allow superscript ⁵, then loose.
const ANCHOR_STRICT = /ESG\s*Risk\s*Rating\s*Assessment\s*5\b/i;
const ANCHOR_SUP    = /ESG\s*Risk\s*Rating\s*Assessment\s*[⁵]/i;
const ANCHOR_LOOSE  = /ESG\s*Risk\s*Rating\s*Assessment(?:\s*[\d¹²³⁴⁵⁶⁷⁸⁹⁰])?/i;

// Page markers as seen in Morningstar PDFs.
const PAGE_MARK = /(?:^|\n)Page\s+\d+\s+of\s+\d+(?:\s*\n|$)/gi;

const ESG_HEADER  = /(?:^|\n)ESG\s*Risk(?:\s*\n|\s|$)/i;
const PEER_HEADER = /(?:^|\n)Peer\s*Analysis(?:\s*\n|\s|$)/i;

// Score categories
const CAT_RE = "(Negligible|Low|Medium|High|Severe)";
// Phrase-bound (label present) and generic patterns.
const RE_PHRASE  = new RegExp(`ESG\\s*Risk\\s*Rating[\\s\\S]{0,160}?(\\d{1,2}(?:\\.\\d+)?)[\\s(]*\\b${CAT_RE}\\b`, "gi");
const RE_GENERIC = new RegExp(`(\\d{1,2}(?:\\.\\d+)?)[\\s(]*\\b${CAT_RE}\\b`, "gi");

// "As of" line
const RE_ASOF = /ESG\s*Risk\s*Rating[^.\n]*?\b(?:is\s+of|as\s+of)\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i;

type Candidate = { value: number; category: EsgParsed["esgCategory"]; index: number; kind: "phrase" | "generic" };

async function parseEsgFromPdf(input: Buffer | Uint8Array | ArrayBuffer): Promise<EsgParsed> {
  // We’ll pull the **full normalized text** (not just page 1).
  // NOTE: extractAllText will be added in pdfExtract.ts in the next step.
  const { fullNormalized } = await extractAllText(input);
  return parseEsgFromText(fullNormalized);
}

export function parseEsgFromText(fullTextRaw: string): EsgParsed {
  if (!fullTextRaw) return {};

  const fullText = normalizeWhitespace(fullTextRaw);

  // 1) Find the anchor.
  const aidx = findAnchorIndex(fullText);
  if (aidx < 0) {
    // As a last resort, attempt ESG/Peer hop directly.
    const hop = hopToNearestSection(fullText, 0);
    return finalizeFromChunk(hop.chunk, hop.anchorInChunk);
  }

  // 2) Try the page-bounded chunk around anchor.
  let { chunk, anchorInChunk } = pageChunkAround(fullText, aidx);
  let result = finalizeFromChunk(chunk, anchorInChunk);
  if (result.esgRisk != null) return result;

  // 3) If none, widen locally (spillover).
  ({ chunk, anchorInChunk } = windowChunk(fullText, aidx, 1200, 3500));
  result = finalizeFromChunk(chunk, anchorInChunk);
  if (result.esgRisk != null) return result;

  // 4) Still none — hop to ESG/Peer sections.
  const hop = hopToNearestSection(fullText, aidx);
  return finalizeFromChunk(hop.chunk, hop.anchorInChunk);
}

// --- Helpers ----------------------------------------------------------------

function findAnchorIndex(text: string): number {
  let m = text.match(ANCHOR_STRICT);
  if (m) return text.search(ANCHOR_STRICT);
  m = text.match(ANCHOR_SUP);
  if (m) return text.search(ANCHOR_SUP);
  m = text.match(ANCHOR_LOOSE);
  if (m) return text.search(ANCHOR_LOOSE);
  return -1;
}

function lastPageMarkBefore(text: string, pos: number): number {
  let lastIdx = -1;
  PAGE_MARK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAGE_MARK.exec(text)) !== null) {
    if (m.index <= pos) lastIdx = m.index;
    else break;
  }
  return lastIdx;
}

function nextPageMarkAfter(text: string, pos: number): number {
  PAGE_MARK.lastIndex = pos >= 0 ? pos : 0;
  const m = PAGE_MARK.exec(text);
  return m ? m.index : -1;
}

function pageChunkAround(text: string, pos: number): { chunk: string; anchorInChunk: number } {
  const prev = lastPageMarkBefore(text, pos);
  const next = nextPageMarkAfter(text, pos + 1);
  const start = prev >= 0 ? Math.max(0, prev - 200) : Math.max(0, pos - 1500);
  const end   = next >= 0 ? Math.min(text.length, next + 200) : Math.min(text.length, pos + 1500);
  const slice = normalizeWhitespace(text.slice(start, end));
  const anchorInSlice =
    slice.search(ANCHOR_STRICT) >= 0 ? slice.search(ANCHOR_STRICT)
      : (slice.search(ANCHOR_SUP) >= 0 ? slice.search(ANCHOR_SUP)
      : slice.search(ANCHOR_LOOSE));
  return { chunk: slice, anchorInChunk: anchorInSlice };
}

function windowChunk(text: string, pos: number, left = 1200, right = 3500): { chunk: string; anchorInChunk: number } {
  const start = Math.max(0, pos - left);
  const end   = Math.min(text.length, pos + right);
  const slice = normalizeWhitespace(text.slice(start, end));
  const anchorInSlice =
    slice.search(ANCHOR_STRICT) >= 0 ? slice.search(ANCHOR_STRICT)
      : (slice.search(ANCHOR_SUP) >= 0 ? slice.search(ANCHOR_SUP)
      : slice.search(ANCHOR_LOOSE));
  return { chunk: slice, anchorInChunk: anchorInSlice };
}

function hopToNearestSection(text: string, from: number): { chunk: string; anchorInChunk: number } {
  const rest = text.slice(from);
  const esgIdxRel  = rest.search(ESG_HEADER);
  const peerIdxRel = rest.search(PEER_HEADER);

  let idx = -1;
  if (esgIdxRel >= 0) idx = from + esgIdxRel;
  else if (peerIdxRel >= 0) idx = from + peerIdxRel;

  if (idx < 0) {
    // No section found; give back a modest window near the tail for debugging.
    return windowChunk(text, Math.min(text.length - 1, Math.max(0, from + 2000)), 800, 2200);
  }
  return pageChunkAround(text, idx);
}

function extractCandidates(chunk: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  // phrase-bound first
  while ((m = RE_PHRASE.exec(chunk)) !== null) {
    const value = parseFloat(m[1]);
    const category = (m[2] as Candidate["category"]);
    const idx = m.index;
    if (Number.isFinite(value) && value >= 0 && value <= 60 && category) {
      const key = `p|${value}|${category.toLowerCase()}|${idx}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ value, category, index: idx, kind: "phrase" });
      }
    }
  }
  // then generic
  while ((m = RE_GENERIC.exec(chunk)) !== null) {
    const value = parseFloat(m[1]);
    const category = (m[2] as Candidate["category"]);
    const idx = m.index;
    if (Number.isFinite(value) && value >= 0 && value <= 60 && category) {
      const key = `g|${value}|${category.toLowerCase()}|${idx}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ value, category, index: idx, kind: "generic" });
      }
    }
  }
  return out;
}

function preferCandidate(cands: Candidate[], anchorInChunk: number): Candidate | null {
  if (!cands.length) return null;

  // Prefer those after the anchor within ~400 chars & phrase-bound.
  const after = (anchorInChunk >= 0)
    ? cands.filter(c => c.index >= anchorInChunk && (c.index - anchorInChunk) <= 400)
    : [];

  const phraseAfter = after.filter(c => c.kind === "phrase");
  if (phraseAfter.length) return phraseAfter[0];

  const phraseAll = cands.filter(c => c.kind === "phrase");
  if (phraseAll.length) return phraseAll[0];

  if (after.length) return after[0];

  // Otherwise the lowest value with Low/Negligible, else the first.
  const safetyPref = cands
    .slice()
    .sort((a, b) => a.value - b.value)
    .find(c => /^(Negligible|Low)$/i.test(c.category || ""));
  return safetyPref || cands[0];
}

function extractAsOf(text: string): string | null {
  const m = RE_ASOF.exec(text);
  return m ? m[1] : null;
}

function finalizeFromChunk(chunk: string, anchorInChunk: number): EsgParsed {
  const cands = extractCandidates(chunk);
  const chosen = preferCandidate(cands, anchorInChunk);
  const asOf = extractAsOf(chunk);

  if (!chosen) {
    return {
      esgRisk: undefined,
      esgCategory: undefined,
      esgAsOf: asOf ?? undefined,
      esgChunkRaw: chunk,
    };
  }

  // Shrink the raw chunk to keep anchor + chosen visible (compact debug).
  const lo = Math.max(0, Math.min(chosen.index, Math.max(anchorInChunk, 0)) - 300);
  const hi = Math.min(chunk.length, Math.max(chosen.index, Math.max(anchorInChunk, 0)) + 800);
  const compact = normalizeWhitespace(chunk.slice(lo, hi));

  return {
    esgRisk: chosen.value,
    esgCategory: chosen.category,
    esgAsOf: asOf ?? undefined,
    esgChunkRaw: compact,
  };
}
