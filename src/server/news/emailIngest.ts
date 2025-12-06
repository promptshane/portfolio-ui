import fs from "fs";
import path from "path";
import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { addPdfFromBuffer, filenameExistsAndValid } from "./store";
import { renderHtmlToPdf, wrapPlainTextAsHtml } from "./emailPdf";

const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_MAX_EMAILS = 20;
const MAX_LOOKBACK_DAYS = 365;
const MAX_EMAIL_FETCH = 2000;

// Determine a writable Gmail dir. In AWS/Amplify lambdas, only /tmp is writable.
const GMAIL_DIR =
  process.env.GMAIL_DIR ||
  (process.env.NODE_ENV === "production" ? "/tmp/gmail" : path.join(process.cwd(), "data", "gmail"));
const CREDENTIALS_PATH =
  process.env.GMAIL_CREDENTIALS_PATH || path.join(GMAIL_DIR, "credentials.json");
const TOKEN_PATH =
  process.env.GMAIL_TOKEN_PATH || path.join(GMAIL_DIR, "token.json");
const CREDENTIALS_JSON = process.env.GMAIL_CREDENTIALS_JSON;
const TOKEN_JSON = process.env.GMAIL_TOKEN_JSON;

type GmailCredentials = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
};

type GmailCredentialsFile =
  | { installed: GmailCredentials }
  | { web: GmailCredentials }
  | GmailCredentials;

export type EmailIngestParams = {
  senders?: string[];
  lookbackDays?: number;
  unreadOnly?: boolean;
  maxEmails?: number;
};

export type EmailIngestSummary = {
  processedEmails: number;
  filesInserted: number;
  duplicates: number;
  pdfUploads: number;
  attachmentPdfUploads: number;
  bodyPdfUploads: number;
  skippedEmails: number;
  totalCandidates: number;
  createdArticleIds: string[];
};

async function ensureGmailDir() {
  await fs.promises.mkdir(GMAIL_DIR, { recursive: true });
}

async function ensureFileFromEnv(envValue: string | undefined, targetPath: string): Promise<boolean> {
  if (!envValue) return false;
  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, envValue, "utf-8");
    return true;
  } catch (err) {
    console.warn(`Failed to write Gmail env file at ${targetPath}:`, err);
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function extractCredentials(
  data: GmailCredentialsFile
): GmailCredentials | null {
  if (!data) return null;
  if ("installed" in data && data.installed) return data.installed;
  if ("web" in data && data.web) return data.web;
  if ("client_id" in data && "client_secret" in data) {
    return data as GmailCredentials;
  }
  return null;
}

async function loadOAuthClient(): Promise<OAuth2Client> {
  await ensureGmailDir();

  // Allow providing credentials/token via env to avoid bundling secrets into the repo.
  // Env-first: if present, write them and use immediately.
  const wroteCreds = await ensureFileFromEnv(CREDENTIALS_JSON, CREDENTIALS_PATH);
  const wroteToken = await ensureFileFromEnv(TOKEN_JSON, TOKEN_PATH);

  // Log source (no secrets)
  const source = wroteCreds || wroteToken ? "env" : "file";
  console.log(`[gmail] using ${source} credentials`, {
    credsLen: CREDENTIALS_JSON?.length ?? 0,
    tokenLen: TOKEN_JSON?.length ?? 0,
    credsPath: CREDENTIALS_PATH,
    tokenPath: TOKEN_PATH,
  });

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "Gmail ingest is not configured: missing credentials.json. Set GMAIL_CREDENTIALS_PATH (or place data/gmail/credentials.json) to enable."
    );
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "Gmail ingest is not configured: missing token.json. Set GMAIL_TOKEN_PATH (or place data/gmail/token.json) to enable."
    );
  }

  const credentialsFile = await readJsonFile<GmailCredentialsFile>(
    CREDENTIALS_PATH
  );
  const credentials = extractCredentials(credentialsFile);

  if (!credentials) {
    throw new Error(
      "Unable to parse Gmail credentials file. Expected installed application credentials."
    );
  }

  const { client_id, client_secret, redirect_uris } = credentials;
  if (!client_id || !client_secret || !redirect_uris?.length) {
    throw new Error(
      "Gmail credentials file is missing client_id, client_secret, or redirect URIs."
    );
  }

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const token = await readJsonFile<Record<string, any>>(TOKEN_PATH);
  oAuth2Client.setCredentials(token);

  oAuth2Client.on("tokens", async (tokens) => {
    if (!tokens) return;
    const merged = { ...token, ...tokens };
    try {
      await fs.promises.writeFile(
        TOKEN_PATH,
        JSON.stringify(merged, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.warn("Failed to persist refreshed Gmail token:", err);
    }
  });

  return oAuth2Client;
}

function decodeBase64Url(data: string | undefined | null): Buffer | null {
  if (!data) return null;
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

function decodeBodyData(data: string | undefined | null): string {
  const buffer = decodeBase64Url(data);
  return buffer ? buffer.toString("utf-8") : "";
}

function walkParts(part?: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  const out: gmail_v1.Schema$MessagePart[] = [part];
  const children = part.parts || [];
  for (const child of children) {
    out.push(...walkParts(child));
  }
  return out;
}

function extractBodies(payload?: gmail_v1.Schema$MessagePart): {
  html: string;
  text: string;
} {
  if (!payload) return { html: "", text: "" };
  const parts = walkParts(payload);
  let textPlain: string | null = null;
  let textHtml: string | null = null;

  for (const part of parts) {
    const mimeType = (part.mimeType || "").toLowerCase();
    if (!mimeType.startsWith("text/")) continue;
    const data = decodeBodyData(part.body?.data);
    if (!data) continue;

    if (mimeType === "text/html" && textHtml === null) {
      textHtml = data.trim();
    } else if (mimeType === "text/plain" && textPlain === null) {
      textPlain = data.trim();
    }
  }

  if (!textHtml && !textPlain && payload.body?.data) {
    const inline = decodeBodyData(payload.body.data).trim();
    if ((payload.mimeType || "").toLowerCase() === "text/html") {
      textHtml = inline;
    } else {
      textPlain = inline;
    }
  }

  return { html: textHtml || "", text: textPlain || "" };
}

const QUOTED_CLASS_PATTERN = /(gmail_quote|gmail_attr)/i;
const FORWARD_MARKER_RE = /-{2,}\s*forwarded message\s*-{2,}/i;
const FORWARD_REFERENCES = ["from:", "date:", "subject:", "to:"];

function removeQuotedSections(html: string): string {
  let cleaned = html;
  cleaned = cleaned.replace(/<head[\s\S]*?<\/head>/gi, " ");
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, " ");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, " ");
  cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, " ");
  const classBlockRe = new RegExp(
    `<[^>]*class=["'][^"']*(${QUOTED_CLASS_PATTERN.source})[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`,
    "gi"
  );
  cleaned = cleaned.replace(classBlockRe, " ");
  return cleaned;
}

function convertHtmlToText(html: string): string {
  let text = removeQuotedSections(html);
  text = text.replace(/<\/?(p|div|tr|li|ul|ol)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?[^>]+>/g, " ");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/\r/g, "");
  return text;
}

function removeForwardHeaderBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  let startIndex = 0;
  let sawForward = false;
  let endIndex = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (sawForward) continue;
      startIndex = i + 1;
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (FORWARD_MARKER_RE.test(lower)) {
      sawForward = true;
      startIndex = i + 1;
      continue;
    }

    if (sawForward) {
      const isRef = FORWARD_REFERENCES.some((ref) => lower.startsWith(ref));
      if (!isRef) {
        endIndex = i;
        break;
      }
    }
  }

  return lines.slice(startIndex, endIndex).join("\n");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildBodyCandidate(payload?: gmail_v1.Schema$MessagePart): {
  html: string;
  cleanedText: string;
} {
  const { html, text } = extractBodies(payload);
  const preferredHtml = html || (text ? wrapPlainTextAsHtml(text) : "");
  if (!preferredHtml) {
    return { html: "", cleanedText: "" };
  }
  const cleanedText = collapseWhitespace(
    removeForwardHeaderBlock(convertHtmlToText(preferredHtml))
  );
  return { html: preferredHtml, cleanedText };
}

function extractAttachmentParts(
  payload?: gmail_v1.Schema$MessagePart
): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  return walkParts(payload).filter((part) => {
    const filename = part.filename || "";
    const attachmentId = part.body?.attachmentId;
    return Boolean(filename && attachmentId);
  });
}

function buildQuery(
  senders: string[],
  lookbackDays: number,
  unreadOnly: boolean
): string {
  let base = `newer_than:${lookbackDays}d`;
  if (unreadOnly) base += " is:unread";
  if (!senders.length) return base;
  const senderQuery = senders.map((s) => `from:${s}`).join(" OR ");
  return `${base} (${senderQuery})`;
}

function safeFilename(name: string, fallback: string): string {
  const base = name && name.trim().length > 0 ? name : fallback;
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 200) || fallback;
}

function toPdfFilename(subject: string | undefined, messageId: string): string {
  const base = (subject || "email").trim().slice(0, 60) || "email";
  const sanitized = base.replace(/[^\w.\-]+/g, "_");
  return `${sanitized}-${messageId}.pdf`;
}

async function fetchMessageIds(
  gmailClient: gmail_v1.Gmail,
  query: string,
  maxEmails: number
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < maxEmails) {
    const remaining = Math.min(500, maxEmails - ids.length);
    const { data } = await gmailClient.users.messages.list({
      userId: "me",
      q: query,
      maxResults: remaining,
      pageToken,
    });

    const messages = data.messages || [];
    for (const message of messages) {
      if (message.id) {
        ids.push(message.id);
        if (ids.length >= maxEmails) break;
      }
    }

    if (!data.nextPageToken || ids.length >= maxEmails) {
      break;
    }
    pageToken = data.nextPageToken;
  }

  return ids;
}

async function fetchPdfAttachments(
  gmailClient: gmail_v1.Gmail,
  messageId: string,
  payload?: gmail_v1.Schema$MessagePart
) {
  const parts = extractAttachmentParts(payload);
  const files: { name: string; data: Buffer }[] = [];

  for (const part of parts) {
    const filename = part.filename || "attachment.pdf";
    const mimeType = (part.mimeType || "").toLowerCase();
    const attachmentId = part.body?.attachmentId;
    if (!attachmentId) continue;

    const isPdf =
      filename.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf";
    if (!isPdf) continue;

    const { data } = await gmailClient.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    const buffer = decodeBase64Url(data.data || "");
    if (buffer) {
      files.push({
        name: safeFilename(filename, "attachment.pdf"),
        data: buffer,
      });
    }
  }

  return files;
}

function normalizeSenders(raw: string[] | undefined): string[] {
  if (!raw?.length) return [];
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export async function ingestEmailsFromGmail(
  params: EmailIngestParams
): Promise<EmailIngestSummary> {
  if (!process.env.S3_BUCKET) {
    throw new Error("S3 is not configured. Email ingest requires cloud storage for PDFs.");
  }
  const senders = normalizeSenders(params.senders || []);
  const lookbackDays = clampNumber(
    params.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    1,
    MAX_LOOKBACK_DAYS
  );
  const unreadOnly = Boolean(params.unreadOnly);
  const maxEmails = clampNumber(
    params.maxEmails ?? DEFAULT_MAX_EMAILS,
    1,
    MAX_EMAIL_FETCH
  );

  const authClient = await loadOAuthClient();
  const gmailClient = google.gmail({ version: "v1", auth: authClient });

  const query = buildQuery(senders, lookbackDays, unreadOnly);
  const messageIds = await fetchMessageIds(gmailClient, query, maxEmails);

  let filesInserted = 0;
  let duplicates = 0;
  let pdfUploads = 0;
  let attachmentPdfUploads = 0;
  let bodyPdfUploads = 0;
  let totalCandidates = 0;
  let skippedEmails = 0;
  const createdArticleIds: string[] = [];

  for (const messageId of messageIds) {
    let payload: gmail_v1.Schema$MessagePart | undefined;
    let headers: gmail_v1.Schema$MessagePartHeader[] = [];
    let subject = "";
    let fromEmail: string | null = null;

    try {
      const { data } = await gmailClient.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      payload = data.payload || undefined;
      headers = payload?.headers || [];
      subject =
        headers.find((h) => (h.name || "").toLowerCase() === "subject")
          ?.value || "";
      const fromHeader =
        headers.find((h) => (h.name || "").toLowerCase() === "from")?.value || "";
      if (fromHeader) {
        const match = fromHeader.match(/<([^>]+)>/);
        const candidate = (match?.[1] || fromHeader || "").trim().toLowerCase();
        const emailMatch = candidate.match(/[^\s@<>]+@[^\s@<>]+/);
        fromEmail = emailMatch ? emailMatch[0].toLowerCase() : null;
      }
    } catch (err) {
      console.error("Failed to fetch Gmail message", messageId, err);
      skippedEmails += 1;
      continue;
    }

    const bodyCandidate = buildBodyCandidate(payload);
    const pdfAttachments = await fetchPdfAttachments(
      gmailClient,
      messageId,
      payload
    );

    const filesForEmail: { name: string; data: Buffer; source: "attachment" | "body" }[] =
      [];

    if (pdfAttachments.length) {
      for (const file of pdfAttachments) {
        filesForEmail.push({ ...file, source: "attachment" });
      }
    } else {
      const textPayload =
        (bodyCandidate.cleanedText && bodyCandidate.cleanedText.trim()) ||
        (bodyCandidate.html && bodyCandidate.html.trim()) ||
        "";
      if (textPayload.length) {
        const pdfName = safeFilename(
          toPdfFilename(subject, messageId),
          `${messageId}.pdf`
        );
        try {
          const pdfBuffer = await renderHtmlToPdf(
            bodyCandidate.html || wrapPlainTextAsHtml(textPayload),
            pdfName
          );
          filesForEmail.push({
            name: pdfName,
            data: pdfBuffer,
            source: "body",
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to convert email body to PDF.";
          console.error("Failed to convert email body", { messageId, message });
          filesForEmail.push({
            name: `${pdfName.replace(/\\.pdf$/i, "") || messageId}.txt`,
            data: Buffer.from(textPayload, "utf-8"),
            source: "body",
          });
        }
      }
    }

    if (!filesForEmail.length) {
      skippedEmails += 1;
      continue;
    }

    totalCandidates += filesForEmail.length;

    for (const file of filesForEmail) {
      if (await filenameExistsAndValid(file.name)) {
        duplicates += 1;
        continue;
      }
      try {
        const { isDuplicate, article } = await addPdfFromBuffer(file.data, file.name, {
          sourceEmail: fromEmail,
        });
        if (isDuplicate) {
          duplicates += 1;
          continue;
        }

        filesInserted += 1;
        if (article?.id) {
          createdArticleIds.push(article.id);
        }
        pdfUploads += 1;
        if (file.source === "attachment") {
          attachmentPdfUploads += 1;
        } else {
          bodyPdfUploads += 1;
        }
      } catch (err) {
        console.error(
          "Failed to store Gmail-derived file",
          file.name,
          messageId,
          err
        );
      }
    }
  }

  return {
    processedEmails: messageIds.length,
    filesInserted,
    duplicates,
    pdfUploads,
    attachmentPdfUploads,
    bodyPdfUploads,
    skippedEmails,
    totalCandidates,
    createdArticleIds,
  };
}
