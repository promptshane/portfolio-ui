// src/app/api/momentum/[symbol]/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ symbol: string }> };

function outDir() {
  return path.join(process.cwd(), "ml", "outputs", "momentum_history");
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const { symbol } = await params;
    const normalized = (symbol || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const fp = path.join(outDir(), `${normalized}.json`);
    if (!fs.existsSync(fp)) {
      return NextResponse.json({ error: `No momentum history for ${normalized}. Run ml/pipeline.py.` }, { status: 404 });
    }
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return NextResponse.json({ symbol: normalized, series: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
