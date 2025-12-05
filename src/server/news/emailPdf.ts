import { Buffer } from "buffer";

const DOCRAPTOR_ENDPOINT =
  process.env.DOCRAPTOR_ENDPOINT || "https://docraptor.com/docs";
const DOCRAPTOR_TEST_MODE = process.env.DOCRAPTOR_TEST_MODE !== "false";
const DEFAULT_TEST_KEY = "YOUR_API_KEY_HERE";
const CSS_PX_PER_IN = 96;
const PDF_PAGE_WIDTH_IN = 8.5;
const PDF_PAGE_MARGIN_IN = 0.5;
const USABLE_PAGE_WIDTH_PX = Math.max(
  0,
  (PDF_PAGE_WIDTH_IN - PDF_PAGE_MARGIN_IN * 2) * CSS_PX_PER_IN
);

// Clamp oversized email markup into the PDF page width and avoid horizontal clipping.
const FIT_TO_WIDTH_STYLES = `
@page {
  size: letter;
  margin: 0.5in;
  prince-shrink-to-fit: auto;
  -prince-shrink-to-fit: auto;
}

html, body {
  --doc-fit-scale: 1;
  --doc-fit-width: 100%;
  width: 100% !important;
  min-width: 0 !important;
  margin: 0 auto;
  padding: 0;
}

body {
  overflow-x: hidden !important;
  transform-origin: top left;
  transform: scale(var(--doc-fit-scale));
  width: var(--doc-fit-width);
}

* {
  box-sizing: border-box !important;
}

img, svg, canvas, video, iframe {
  max-width: 100% !important;
  height: auto !important;
}

table {
  width: 100% !important;
  max-width: 100% !important;
  table-layout: fixed !important;
}

div, section, article {
  max-width: 100% !important;
}

td, th {
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
}

pre, code {
  white-space: pre-wrap !important;
  word-break: break-word !important;
}
`;

const FIT_TO_WIDTH_SCRIPT = `
(function() {
  try {
    var root = document.documentElement;
    var body = document.body || root;
    var usable = Math.max(0, (${PDF_PAGE_WIDTH_IN} - ${PDF_PAGE_MARGIN_IN} * 2) * ${CSS_PX_PER_IN});
    if (!usable) return;
    var widths = [
      root.scrollWidth || 0,
      body.scrollWidth || 0,
      root.offsetWidth || 0,
      body.offsetWidth || 0
    ];
    var maxWidth = Math.max.apply(Math, widths);
    if (!maxWidth || maxWidth <= usable) return;
    var scale = usable / maxWidth;
    if (scale >= 0.999) return;
    root.style.setProperty("--doc-fit-scale", String(scale));
    root.style.setProperty("--doc-fit-width", (100 / scale) + "%");
    body.style.setProperty("--doc-fit-scale", String(scale));
    body.style.setProperty("--doc-fit-width", (100 / scale) + "%");
  } catch (err) {
    /* ignore */
  }
})();
`;

function resolveApiKey(testMode: boolean): string {
  const envKey =
    process.env.DOCRAPTOR_API_KEY || process.env.DOC_RAPTOR_API_KEY || "";
  if (envKey) return envKey;
  if (testMode) return DEFAULT_TEST_KEY;
  throw new Error(
    "DocRaptor API key is not configured (set DOCRAPTOR_API_KEY or DOC_RAPTOR_API_KEY)."
  );
}

export function wrapPlainTextAsHtml(text: string): string {
  const safe = (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withBreaks = safe.replace(/\r?\n/g, "<br>");
  return `<html><body>${withBreaks}</body></html>`;
}

function injectFitToWidthStyles(html: string): string {
  const styleTag = `<style id="docraptor-fit-to-width">${FIT_TO_WIDTH_STYLES}</style>`;
  const scriptTag = `<script id="docraptor-fit-to-width-script">${FIT_TO_WIDTH_SCRIPT}</script>`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${styleTag}${scriptTag}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}${scriptTag}</head>`);
  }

  return `<!doctype html><html><head>${styleTag}${scriptTag}</head><body>${html}</body></html>`;
}

// Light-touch HTML normalization to clamp oversized fixed widths before rendering to PDF.
function normalizeWideMarkup(html: string): string {
  let adjusted = false;

  const clampWidthAttribute = (input: string) =>
    input.replace(
      /(\bwidth\s*=\s*)(["']?)(\d{3,5})(px)?(["']?)/gi,
      (full, prefix, quote, value, _px, endQuote) => {
        const width = parseInt(value, 10);
        if (!Number.isFinite(width) || width <= USABLE_PAGE_WIDTH_PX) {
          return full;
        }
        adjusted = true;
        const q = quote || endQuote || "";
        return `${prefix}${q}100%${q}`;
      }
    );

  const clampWidthStyle = (input: string, prop: "width" | "min-width") =>
    input.replace(
      new RegExp(`(${prop}\\s*:\\s*)(\\d{3,5})px`, "gi"),
      (full, prefix, value) => {
        const width = parseInt(value, 10);
        if (!Number.isFinite(width) || width <= USABLE_PAGE_WIDTH_PX) {
          return full;
        }
        adjusted = true;
        const replacement =
          prop === "min-width" ? "auto !important" : "100% !important";
        return `${prefix}${replacement}`;
      }
    );

  const step1 = clampWidthAttribute(html);
  const step2 = clampWidthStyle(step1, "width");
  const step3 = clampWidthStyle(step2, "min-width");

  return adjusted ? step3 : html;
}

export async function renderHtmlToPdf(html: string, filename: string): Promise<Buffer> {
  const trimmed = (html || "").trim();
  if (!trimmed) {
    throw new Error("No HTML provided for PDF render.");
  }

  const testMode = DOCRAPTOR_TEST_MODE;
  const apiKey = resolveApiKey(testMode);
  const normalizedHtml = normalizeWideMarkup(trimmed);
  const preparedHtml = injectFitToWidthStyles(normalizedHtml);

  const payload = {
    test: true,
    document_type: "pdf",
    document_content: preparedHtml,
    name: filename || "email.pdf",
    javascript: true,
  };

  const response = await fetch(DOCRAPTOR_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `DocRaptor request failed (${response.status}): ${text.slice(0, 300)}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
