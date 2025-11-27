import { promises as fs } from "fs";
import path from "path";
import { getObjectBuffer, putObjectBuffer, s3Enabled } from "./s3Client";

/** Server-side storage for FTV PDFs + metadata (JSON index).
 *  Local-dev friendly; easy to swap to S3/DB later by re-implementing these functions.
 */

export type FtvParsedFields = {
  // Optional fields parsed from the first page of the PDF
  ftvEstimate?: number;
  ftvAsOf?: string;
  moat?: "Wide" | "Narrow" | "None" | string;
  styleBox?: string;
  uncertainty?: "Low" | "Medium" | "High" | "Very High" | "Extreme" | string;
  capitalAllocation?: "Poor" | "Standard" | "Exemplary" | string;

  // ESG (document-scope; may require full-doc parse)
  esgRisk?: number;
  esgAsOf?: string;
  esgCategory?: "Negligible" | "Low" | "Medium" | "High" | "Severe" | string;
  /** Compact raw slice containing the matched ESG score (for debug/auditing). */
  esgChunkRaw?: string;
};

export type FtvParseMeta = {
  parseVersion?: string;
  parsedAt?: string; // ISO timestamp
};

export type FtvDocMeta = {
  symbol: string;        // Uppercased ticker (AAPL, MSFT, etc.)
  /** If present, a public URL under /public (e.g., /ftv/AAPL/<file>.pdf). */
  url?: string;
  /** Physical filename placed in /public/ftv/<SYMBOL>/ */
  filename?: string;
  /** Present only when a PDF was uploaded. */
  uploadedAt?: string;    // ISO timestamp when the PDF was uploaded
  /** Present when user confirmed the latest state (with or without a PDF). */
  confirmedAt?: string;   // ISO timestamp when "Confirm" was pressed
  /** Helper flag we set when confirming without a PDF present. */
  missingConfirmed?: boolean;
} & FtvParsedFields & FtvParseMeta;

type IndexShape = Record<string, FtvDocMeta[]>;

const ROOT = process.cwd();
const isLambda = !!process.env.AWS_EXECUTION_ENV;
// Prefer a writable tmp path in production/lambda unless explicitly overridden.
const LOCAL_ROOT =
  process.env.FTV_LOCAL_ROOT ||
  (process.env.NODE_ENV === "production" || isLambda ? "/tmp/ftv" : ROOT);
const DATA_DIR = path.join(LOCAL_ROOT, "data", "ftv");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const PUBLIC_DIR = path.join(LOCAL_ROOT, "public", "ftv");
const S3_INDEX_KEY = "ftv/index.json";

function sanitizeSymbol(sym: string) {
  return (sym || "").toUpperCase().replace(/[^A-Z0-9\-]/g, "").slice(0, 12);
}
function nowISO() {
  return new Date().toISOString();
}
function safeTsForFile(ts: string) {
  // Replace characters that aren't file-system friendly
  return ts.replace(/[:.]/g, "-");
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
}

async function readIndex(): Promise<IndexShape> {
  // Prefer S3 when configured
  if (s3Enabled) {
    try {
      const buf = await getObjectBuffer(S3_INDEX_KEY);
      if (buf) {
        const parsed = JSON.parse(buf.toString("utf8"));
        return typeof parsed === "object" && parsed ? parsed : {};
      }
    } catch {
      // fall back to local
    }
  }

  await ensureDirs();
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function listAllLatest(): Promise<FtvDocMeta[]> {
  const idx = await readIndex();
  const out: FtvDocMeta[] = [];
  for (const arr of Object.values(idx)) {
    if (Array.isArray(arr) && arr.length) {
      out.push(arr[arr.length - 1]);
    }
  }
  return out;
}

async function writeIndex(idx: IndexShape) {
  const payload = JSON.stringify(idx, null, 2);
  if (s3Enabled) {
    await putObjectBuffer({
      key: S3_INDEX_KEY,
      body: Buffer.from(payload, "utf8"),
      contentType: "application/json",
      tags: { section: "ftv", kind: "index" },
      metadata: { section: "ftv", kind: "index" },
    });
    return;
  }
  await ensureDirs();
  await fs.writeFile(INDEX_FILE, payload, "utf8");
}

async function writePdfFile(symbol: string, fileBuf: Buffer, originalName?: string) {
  const sym = sanitizeSymbol(symbol);
  const ts = safeTsForFile(nowISO());
  const base = (originalName || `${sym}.pdf`).replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  const ext = path.extname(base).toLowerCase() || ".pdf";
  const fileName = `${ts}-${base.replace(ext, "")}${ext === ".pdf" ? "" : ".pdf"}`.toLowerCase();

  const key = `ftv/${sym}/${fileName}`;

  if (s3Enabled) {
    await putObjectBuffer({
      key,
      body: fileBuf,
      contentType: "application/pdf",
      tags: { section: "ftv", kind: "pdf", symbol: sym },
      metadata: { section: "ftv", kind: "pdf", symbol: sym },
    });
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION || "us-east-1";
    const publicUrl = bucket ? `https://${bucket}.s3.${region}.amazonaws.com/${key}` : undefined;
    return { fileName, publicUrl };
  }

  const destDir = path.join(PUBLIC_DIR, sym);
  await fs.mkdir(destDir, { recursive: true });

  const destPath = path.join(destDir, fileName);
  await fs.writeFile(destPath, fileBuf);

  const publicUrl = `/ftv/${sym}/${fileName}`;
  return { fileName, publicUrl };
}

/** List all documents for a symbol (latest last). */
export async function list(symbol: string): Promise<FtvDocMeta[]> {
  const sym = sanitizeSymbol(symbol);
  const idx = await readIndex();
  return idx[sym]?.slice() ?? [];
}

/** Get latest document for a symbol. */
export async function getLatest(symbol: string): Promise<FtvDocMeta | undefined> {
  const docs = await list(symbol);
  return docs.length ? docs[docs.length - 1] : undefined;
}

/** Add a new PDF for a symbol and update index. */
export async function addPdf(params: {
  symbol: string;
  buffer: Buffer;
  originalName?: string;
  parsed?: FtvParsedFields & FtvParseMeta; // optional parsed fields + parse metadata
}): Promise<FtvDocMeta> {
  const sym = sanitizeSymbol(params.symbol);
  if (!sym) throw new Error("Invalid symbol");
  if (!params.buffer?.length) throw new Error("Empty file buffer");

  const { fileName, publicUrl } = await writePdfFile(sym, params.buffer, params.originalName);

  const meta: FtvDocMeta = {
    symbol: sym,
    url: publicUrl,
    filename: fileName,
    uploadedAt: nowISO(),
    ...(params.parsed || {}),
  };

  const idx = await readIndex();
  const arr = idx[sym] ?? [];
  arr.push(meta);
  idx[sym] = arr;
  await writeIndex(idx);

  return meta;
}

/** Stamp 'confirmedAt' on the latest doc;
 *  if NO doc exists yet, create a stub entry representing "confirmed missing PDF".
 */
export async function confirmLatest(symbol: string): Promise<FtvDocMeta | undefined> {
  const sym = sanitizeSymbol(symbol);
  const idx = await readIndex();
  const arr = idx[sym] ?? [];

  if (!arr.length) {
    const stub: FtvDocMeta = {
      symbol: sym,
      confirmedAt: nowISO(),
      missingConfirmed: true,
      // no url/filename/uploadedAt on purpose
    };
    idx[sym] = [stub];
    await writeIndex(idx);
    return stub;
  }

  const current = arr[arr.length - 1];
  const updated: FtvDocMeta = {
    ...current,
    confirmedAt: nowISO(),
    // If there is no PDF on the latest entry, mark that this was an explicit "missing confirmed".
    ...(current?.url ? {} : { missingConfirmed: true }),
  };

  arr[arr.length - 1] = updated;
  idx[sym] = arr;
  await writeIndex(idx);
  return updated;
}

/** Merge parsed fields (and parse metadata) into the latest doc and persist the index. */
export async function mergeIntoLatest(
  symbol: string,
  patch: FtvParsedFields & FtvParseMeta
): Promise<FtvDocMeta | undefined> {
  const sym = sanitizeSymbol(symbol);
  const idx = await readIndex();
  const arr = idx[sym];
  if (!arr || !arr.length) return undefined;

  const current = arr[arr.length - 1];
  const merged: FtvDocMeta = { ...current };

  type ParsedKey = keyof (FtvParsedFields & FtvParseMeta);
  for (const [k, v] of Object.entries(patch) as [ParsedKey, unknown][]) {
    if (v !== undefined) {
      (merged as any)[k] = v;
    }
  }

  arr[arr.length - 1] = merged;
  idx[sym] = arr;
  await writeIndex(idx);

  return merged;
}

/** Resolve absolute path to a stored PDF for a given meta. */
function resolvePdfPath(meta: FtvDocMeta): string {
  const sym = sanitizeSymbol(meta.symbol);
  return path.join(PUBLIC_DIR, sym, meta.filename || "");
}

/** Read the latest PDF file bytes for a symbol (for on-demand reparse). */
export async function readLatestPdf(symbol: string): Promise<Buffer | undefined> {
  const latest = await getLatest(symbol);
  if (!latest?.filename) return undefined;
  const key = `ftv/${sanitizeSymbol(symbol)}/${latest.filename}`;
  if (s3Enabled) {
    try {
      return await getObjectBuffer(key) ?? undefined;
    } catch {
      return undefined;
    }
  }
  const abs = resolvePdfPath(latest);
  try {
    return await fs.readFile(abs);
  } catch {
    return undefined;
  }
}

/** Convenience for API responses. */
export async function getDocsResponse(symbol: string) {
  const all = await list(symbol);
  const latest = all.length ? all[all.length - 1] : undefined;
  return { latest, all };
}

export const ftvStore = {
  list,
  listAllLatest,
  getLatest,
  addPdf,
  confirmLatest,
  mergeIntoLatest,
  getDocsResponse,
  readLatestPdf,
};
