/* Node-only utility: extract normalized text from the FIRST page of a PDF,
   plus a helper to extract the FULL document text (normalized). */
"use strict";

import pdfParse, {
  type PdfParseOptions,
  type PdfPageData,
  type PdfParseResult,
} from "pdf-parse";

export type PdfExtractResult = {
  /** Raw text returned by the parser for page 1 (minimal processing). */
  raw: string;
  /** Normalized text with whitespace & common PDF artifacts cleaned for regex parsing. */
  normalized: string;
  /** Best-effort metadata. `info` shape depends on the underlying parser. */
  meta: {
    pages?: number;
    info?: Record<string, unknown>;
  };
};

export type PdfAllExtractResult = {
  /** Raw text of the entire document (all pages). */
  fullRaw: string;
  /** Normalized text of the entire document (all pages). */
  fullNormalized: string;
  /** Best-effort metadata. */
  meta: {
    pages?: number;
    info?: Record<string, unknown>;
  };
};

/** Accept Node Buffer / ArrayBuffer / Uint8Array and return a Node Buffer. */
function toBuffer(input: Buffer | ArrayBuffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  return Buffer.from(new Uint8Array(input as ArrayBuffer));
}

/** Light Unicode/whitespace normalization tailored for label-based parsing. */
function normalizeText(s: string): string {
  if (!s) return s;

  // Replace typical PDF unicode artifacts
  const replaced = s
    .replace(/\u00A0/g, " ")              // non-breaking space
    .replace(/\u00AD/g, "")               // soft hyphen
    .replace(/\u2013|\u2014/g, "-")       // en/em dash -> hyphen
    .replace(/\u2018|\u2019/g, "'")       // curly single quotes
    .replace(/\u201C|\u201D/g, '"')       // curly double quotes
    .replace(/\u2122|\u00AE|\u00A9/g, "") // ™ ® ©
    .replace(/[·•▪◦]/g, " ");             // bullets -> space

  // Collapse line breaks & tabs to spaces (regexes are whitespace-tolerant)
  const flattened = replaced.replace(/[\r\n\t]+/g, " ");

  // Remove stray spaces around slashes/colons commonly found in labels
  const tightened = flattened
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*,\s*/g, ", ");

  // Collapse multiple spaces
  return tightened.replace(/ {2,}/g, " ").trim();
}

/**
 * Extract text from ONLY the first page.
 * Returns both `raw` and `normalized` for downstream regex matching.
 */
export async function extractFirstPageText(
  input: Buffer | ArrayBuffer | Uint8Array
): Promise<PdfExtractResult> {
  const buf = toBuffer(input);

  // Limit to first page; keep a deterministic, whitespace-friendly render.
  const options: PdfParseOptions = {
    max: 1,
    pagerender: (pageData: PdfPageData) =>
      pageData.getTextContent().then((tc) => {
        const strs = (tc.items || []).map((it) => it?.str ?? "");
        return strs.join(" ");
      }),
  };

  let parsed: PdfParseResult;
  try {
    parsed = await pdfParse(buf, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF parse failed (first page): ${msg}`);
  }

  const raw: string = typeof parsed?.text === "string" ? parsed.text : "";
  const normalized = normalizeText(raw);

  const meta = {
    pages: typeof parsed?.numpages === "number" ? parsed.numpages : undefined,
    info: parsed?.info ?? undefined,
  };

  return { raw, normalized, meta };
}

/**
 * Extract text from the FULL document (all pages), normalized for regex parsing.
 * Used by ESG parsing which may live beyond the first page.
 */
export async function extractAllText(
  input: Buffer | ArrayBuffer | Uint8Array
): Promise<PdfAllExtractResult> {
  const buf = toBuffer(input);

  const options: PdfParseOptions = {
    // No `max`: include all pages; maintain whitespace-friendly render.
    pagerender: (pageData: PdfPageData) =>
      pageData.getTextContent().then((tc) => {
        const strs = (tc.items || []).map((it) => it?.str ?? "");
        return strs.join(" ");
      }),
  };

  let parsed: PdfParseResult;
  try {
    parsed = await pdfParse(buf, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF parse failed (full doc): ${msg}`);
  }

  const fullRaw: string = typeof parsed?.text === "string" ? parsed.text : "";
  const fullNormalized = normalizeText(fullRaw);

  const meta = {
    pages: typeof parsed?.numpages === "number" ? parsed.numpages : undefined,
    info: parsed?.info ?? undefined,
  };

  return { fullRaw, fullNormalized, meta };
}

export default extractFirstPageText;
