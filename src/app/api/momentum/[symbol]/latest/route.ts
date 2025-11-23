// src/app/api/momentum/[symbol]/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ symbol: string }> };

function outDir() {
  // read from project-relative ml/outputs
  return path.join(process.cwd(), "ml", "outputs");
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const { symbol } = await params;
    const normalized = (symbol || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const latestPath = path.join(outDir(), "momentum_latest.json");
    if (!fs.existsSync(latestPath)) {
      return NextResponse.json(
        { error: "ML outputs not found. Run ml/pipeline.py first." },
        { status: 404 }
      );
    }
    const payload = JSON.parse(fs.readFileSync(latestPath, "utf-8")) as any[];
    const row = payload.find((r) => r.symbol === normalized);
    if (!row) {
      return NextResponse.json({ error: `No latest momentum for ${normalized}` }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
