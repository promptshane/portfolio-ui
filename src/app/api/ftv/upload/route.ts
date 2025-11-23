// src/app/api/ftv/upload/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ftvStore } from "@/server/ftvStore";
import parseFtvPdf from "@/server/ftvParser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const dev = (await cookies()).get("ftv_dev");
  if (!dev || dev.value !== "1") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const symbol = String(form.get("symbol") ?? "").toUpperCase();
  const file = form.get("file") as File | null;

  if (!symbol) {
    return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }

  // Basic PDF validation
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "document.pdf").toLowerCase();
  const isPdf = type.includes("pdf") || name.endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ ok: false, error: "Only PDF files are allowed" }, { status: 400 });
  }

  // Convert to Buffer and persist
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) {
    return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
  }

  // Optional size guard (e.g., 25MB)
  const MAX_BYTES = 25 * 1024 * 1024;
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large" }, { status: 413 });
  }

  // Parse (includes ESG fields) — non-blocking for success
  let parsed: unknown = undefined;
  try {
    parsed = await parseFtvPdf(buf);
  } catch {
    parsed = undefined;
  }

  // Store the PDF and any parsed fields
  const meta = await ftvStore.addPdf({ symbol, buffer: buf, originalName: name, parsed } as any);

  return NextResponse.json({ ok: true, latest: meta });
}
