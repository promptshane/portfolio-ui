import { NextResponse } from "next/server";
import { getDiscountHubData } from "@/server/discountHub";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getDiscountHubData();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("Failed to load discount positions", err);
    return NextResponse.json({ ok: false, error: "Failed to load discount positions" }, { status: 500 });
  }
}
