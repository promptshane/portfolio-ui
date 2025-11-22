// src/app/api/news/email-ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  ingestEmailsFromGmail,
  type EmailIngestSummary,
} from "@/server/news/emailIngest";

export const runtime = "nodejs";

function parseSenders(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => (typeof value === "string" ? value : ""))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

export async function POST(req: NextRequest) {
  try {
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      // fall through with default payload
    }

    const senders = parseSenders(payload?.senders ?? payload?.verified);
    const lookbackDays = Number(payload?.lookbackDays);
    const unreadOnly = Boolean(payload?.unreadOnly);
    const maxEmails = Number(payload?.maxEmails);

    const summary: EmailIngestSummary = await ingestEmailsFromGmail({
      senders,
      lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : undefined,
      unreadOnly,
      maxEmails: Number.isFinite(maxEmails) ? maxEmails : undefined,
    });

    return NextResponse.json(
      {
        status: "ok",
        summary,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error during Gmail ingest:", err);
    const message =
      typeof err?.message === "string"
        ? err.message
        : "Failed to load emails.";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
