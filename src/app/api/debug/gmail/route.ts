import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function summarize(name: string, value: string | undefined | null) {
  return {
    present: Boolean(value),
    length: value?.length ?? 0,
    name,
  };
}

async function ensureTmpDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function writeIfEnv(key: string, value: string | undefined, target: string) {
  if (!value) return false;
  await ensureTmpDir(path.dirname(target));
  await fs.promises.writeFile(target, value, "utf-8");
  return true;
}

function log(msg: string, meta?: Record<string, unknown>) {
  console.log(`[debug/gmail] ${msg}`, meta ?? {});
}

export async function GET() {
  const envCreds = process.env.GMAIL_CREDENTIALS_JSON;
  const envToken = process.env.GMAIL_TOKEN_JSON;
  const credsSummary = summarize("GMAIL_CREDENTIALS_JSON", envCreds);
  const tokenSummary = summarize("GMAIL_TOKEN_JSON", envToken);

  // Prepare a test client if envs exist
  let gmailOk = false;
  let gmailError: string | undefined;
  let source: "env" | "file" | "missing" = "missing";

  const gmailDir =
    process.env.GMAIL_DIR ||
    (process.env.NODE_ENV === "production" ? "/tmp/gmail" : path.join(process.cwd(), "data", "gmail"));
  const credsPath = process.env.GMAIL_CREDENTIALS_PATH || path.join(gmailDir, "credentials.json");
  const tokenPath = process.env.GMAIL_TOKEN_PATH || path.join(gmailDir, "token.json");

  try {
    if (envCreds || envToken) {
      // env-first: if provided, write to temp files and use them
      await writeIfEnv("GMAIL_CREDENTIALS_JSON", envCreds, credsPath);
      await writeIfEnv("GMAIL_TOKEN_JSON", envToken, tokenPath);
      source = "env";
    } else if (fs.existsSync(credsPath) && fs.existsSync(tokenPath)) {
      source = "file";
    } else {
      source = "missing";
    }

    if (source !== "missing") {
      const credsRaw = await fs.promises.readFile(credsPath, "utf-8");
      const tokenRaw = await fs.promises.readFile(tokenPath, "utf-8");
      const credentials = JSON.parse(credsRaw);
      const { client_id, client_secret, redirect_uris } =
        credentials?.installed || credentials?.web || {};

      if (!client_id || !client_secret || !redirect_uris?.length) {
        throw new Error("Credentials missing client_id/client_secret/redirect_uris");
      }

      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );
      const tokenObj = JSON.parse(tokenRaw);
      oAuth2Client.setCredentials(tokenObj);
      const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
      await gmail.users.getProfile({ userId: "me" });
      gmailOk = true;
    }
  } catch (err: any) {
    gmailError = err?.message || String(err);
    log("gmail ping failed", { error: gmailError });
  }

  return NextResponse.json({
    env: {
      credentials: credsSummary,
      token: tokenSummary,
    },
    source,
    gmail: {
      ok: gmailOk,
      error: gmailError,
    },
  });
}
