import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Serves ML-driven momentum weight files produced offline.
 * Looks up: /ml/outputs/weights/<SYMBOL>.json (uppercase), then <symbol>.json (lowercase), then global.json.
 *
 * Example JSON shape:
 * {
 *   "asOf": "2025-10-01",
 *   "confidence": 0.78,
 *   "indicator": {
 *     "trend":   {"band": 0.15, "rsi": 0.25, "macd": 0.60},
 *     "range":   {"band": 0.55, "rsi": 0.35, "macd": 0.10},
 *     "extreme": {"band": 0.70, "rsi": 0.25, "macd": 0.05},
 *     "default": {"band": 0.30, "rsi": 0.30, "macd": 0.40}
 *   },
 *   "horizon": {"5":0.22,"10":0.20,"20":0.18,"40":0.16,"80":0.12,"160":0.12},
 *   "minConfidence": 0.6,
 *   "applyPerBar": true,
 *   "bucketFallback": "default"
 * }
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const root = process.cwd();
  const baseDir = path.join(root, "ml", "outputs", "weights");

  const symbolRaw = (params.symbol || "").trim();
  if (!symbolRaw) {
    return new Response(JSON.stringify({ error: "symbol required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const candidates = [
    path.join(baseDir, `${symbolRaw.toUpperCase()}.json`),
    path.join(baseDir, `${symbolRaw.toLowerCase()}.json`),
    path.join(baseDir, `global.json`),
  ];

  let payload: any = null;
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p, "utf8");
      payload = JSON.parse(buf);
      break;
    } catch {
      // keep trying next candidate
    }
  }

  if (!payload) {
    return new Response(JSON.stringify({ error: "weights not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // minimal validation + defensive renaming
  const out: any = {};
  if (payload.asOf) out.asOf = String(payload.asOf);
  if (typeof payload.confidence === "number") out.confidence = payload.confidence;
  if (typeof payload.minConfidence === "number") out.minConfidence = payload.minConfidence;
  if (typeof payload.applyPerBar === "boolean") out.applyPerBar = payload.applyPerBar;
  if (typeof payload.bucketFallback === "string") out.bucketFallback = payload.bucketFallback;

  if (payload.indicator && typeof payload.indicator === "object") {
    out.indicator = payload.indicator;
  }
  if (payload.horizon && typeof payload.horizon === "object") {
    out.horizon = payload.horizon;
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
