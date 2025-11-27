import { NextResponse } from "next/server";
import { ftvStore } from "@/server/ftvStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await ftvStore.listAllLatest();
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load FTV docs" },
      { status: 500 }
    );
  }
}
