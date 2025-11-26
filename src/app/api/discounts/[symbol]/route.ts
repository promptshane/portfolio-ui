import { NextRequest, NextResponse } from "next/server";
import { getDiscountForSymbol } from "@/server/discountHub";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const sym = (symbol || "").trim();
    if (!sym) {
      return NextResponse.json({ ok: false, error: "No symbol provided" }, { status: 400 });
    }

    const data = await getDiscountForSymbol(sym);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("Failed to load discount data for symbol", err);
    return NextResponse.json({ ok: false, error: "Failed to load discount data" }, { status: 500 });
  }
}
