import { NextRequest, NextResponse } from "next/server";
import { ftvStore } from "@/server/ftvStore";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const { latest } = await ftvStore.getDocsResponse(symbol);
    if (!latest?.filename) {
      return NextResponse.json({ error: "No PDF found for symbol" }, { status: 404 });
    }

    const buf = await ftvStore.readLatestPdf(symbol);
    if (!buf?.length) {
      return NextResponse.json({ error: "PDF unavailable" }, { status: 404 });
    }

    const filename = latest.filename || `${symbol}.pdf`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    console.error("Failed to stream FTV PDF", err);
    return NextResponse.json({ error: "Unable to load PDF" }, { status: 500 });
  }
}
