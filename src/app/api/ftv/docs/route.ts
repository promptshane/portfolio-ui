import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ftvStore } from "@/server/ftvStore";
import parseFtvPdf, { CURRENT_PARSE_VERSION } from "@/server/ftvParser";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function reparseIfStale(symbol: string) {
  const { latest } = await ftvStore.getDocsResponse(symbol);
  if (!latest) return { latest, all: [] as typeof latest[] };

  const needsParse =
    !latest.parseVersion ||
    latest.parseVersion !== CURRENT_PARSE_VERSION ||
    latest.ftvEstimate === undefined ||
    latest.ftvAsOf === undefined ||
    latest.moat === undefined ||
    latest.uncertainty === undefined ||
    latest.capitalAllocation === undefined ||
    latest.styleBox === undefined ||
    latest.esgRisk === undefined ||
    latest.esgAsOf === undefined ||
    latest.esgCategory === undefined;

  if (!needsParse) {
    return await ftvStore.getDocsResponse(symbol);
  }

  try {
    const buf = await ftvStore.readLatestPdf(symbol);
    if (!buf) {
      return await ftvStore.getDocsResponse(symbol);
    }
    const parsed = await parseFtvPdf(buf);
    const merged = await ftvStore.mergeIntoLatest(symbol, parsed);
    return { latest: merged, all: await ftvStore.list(symbol) };
  } catch {
    return await ftvStore.getDocsResponse(symbol);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return bad("Missing symbol");

  const data = await reparseIfStale(symbol);
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return bad("Missing symbol");

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* noop */
  }

  const action = body?.action;
  if (action !== "confirm") return bad("Unsupported action");

  const cookie = cookies().get("ftv_dev");
  if (!cookie || cookie.value !== "1") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // IMPORTANT: this now creates a stub if no PDF exists yet.
  const latest = await ftvStore.confirmLatest(symbol);
  return NextResponse.json({ ok: true, latest });
}
