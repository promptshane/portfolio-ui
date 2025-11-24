import fs from "fs";
import path from "path";
import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { addPdfFromBuffer } from "./store";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_EMAILS = 100;
const MIN_CLEAN_WORDS_FOR_UPLOAD = 80;
const MAX_LOOKBACK_DAYS = 365;
const MAX_EMAIL_FETCH = 2000;

const GMAIL_DIR = path.join(process.cwd(), "data", "gmail");
const CREDENTIALS_PATH =
  process.env.GMAIL_CREDENTIALS_PATH ||
  path.join(GMAIL_DIR, "credentials.json");
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
  textUploads: number;
  skippedEmails: number;
  totalCandidates: number;
  createdArticleIds: string[];
};

const REPLY_CUTOFF_PATTERNS = [
  /^begin forwarded message:.*$/i,
  /^forwarded message.*$/i,
  /^fwd:\s+.*$/i,
  /^on .* wrote:.*$/i,
  /^from:\s+.*$/i,
  /^sent:\s+.*$/i,
  /^date:\s+.*$/i,
  /^subject:\s+.*$/i,
  /^to:\s+.*$/i,
  /^cc:\s+.*$/i,
  /^reply-to:\s+.*$/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
];

const FOOTER_STOP_PATTERNS = [
  /^good investing,?\s*$/i,
  /^all the best,?\s*$/i,
  /^sincerely,?\s*$/i,
  /^regards,?\s*$/i,
  /^best regards,?\s*$/i,
  /^published by\b.*$/i,
  /^you are receiving this e-?mail\b.*$/i,
  /^if you no longer want to receive\b.*$/i,
  /^unsubscribe\b.*$/i,
  /^privacy policy\b.*$/i,
  /^terms of (service|use)\b.*$/i,
  /^©\s*\d{4}\b.*$/i,
  /^\(c\)\s*\d{4}\b.*$/i,
  /^all rights reserved\b.*$/i,
  /^the law prohibits\b.*$/i,
];

const URL_RE = /https?:\/\/\S+/gi;
const CSSISH_RE = /(\{|\}|;|\bfont-|\bcolor:|\bpadding:|\bmargin:)/i;
const NOISE_CONTAINS = [
  "delivering world-class financial research",
  "view this email in your browser",
  "trouble viewing this email",
  "email preference center",
];

async function ensureGmailDir() {
  await fs.promises.mkdir(GMAIL_DIR, { recursive: true });
}

async function ensureFileFromEnv(envValue: string | undefined, targetPath: string) {
  if (!envValue) return;
  try {
    await fs.promises.writeFile(targetPath, envValue, "utf-8");
  } catch {
    // swallow; downstream checks will emit a clearer message
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

  // Allow providing credentials/token via env to avoid bundling secrets into the repo
  await ensureFileFromEnv(CREDENTIALS_JSON, CREDENTIALS_PATH);
  await ensureFileFromEnv(TOKEN_JSON, TOKEN_PATH);

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

function extractBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  const parts = walkParts(payload);
  let textPlain: string | null = null;
  let textHtml: string | null = null;

  for (const part of parts) {
    const mimeType = (part.mimeType || "").toLowerCase();
    if (!part.body) continue;
    const data = decodeBodyData(part.body.data);
    if (!data) continue;

    if (mimeType === "text/plain" && textPlain === null) {
      textPlain = data.trim();
    } else if (mimeType === "text/html" && textHtml === null) {
      textHtml = data.trim();
    }
  }

  if (textPlain) return textPlain;
  if (textHtml) {
    return textHtml.replace(/<[^>]+>/g, " ").trim();
  }
  return "";
}

function stripUrls(line: string): string {
  return line.replace(URL_RE, "");
}

function isForwardHeaderLine(line: string): boolean {
  return REPLY_CUTOFF_PATTERNS.some((re) => re.test(line));
}

function isFooterLine(line: string): boolean {
  return FOOTER_STOP_PATTERNS.some((re) => re.test(line));
}

function isNoiseLine(lineRaw: string): boolean {
  const line = lineRaw || "";
  const trimmedLower = line.trim().toLowerCase();
  if (!trimmedLower) return true;
  if (CSSISH_RE.test(line)) return true;
  if (NOISE_CONTAINS.some((phrase) => trimmedLower.includes(phrase))) {
    return true;
  }
  const withoutUrls = stripUrls(line).trim();
  if (!withoutUrls) return true;
  if (trimmedLower.startsWith("http://") || trimmedLower.startsWith("https://")) {
    return true;
  }
  if (trimmedLower.includes("click here") && withoutUrls.length < 60) {
    return true;
  }
  return false;
}

function seemsContentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isNoiseLine(line)) return false;
  if (isFooterLine(trimmed.toLowerCase())) return false;
  const alphaCount = (line.match(/[A-Za-z]/g) || []).length;
  return alphaCount >= 3;
}

function cleanBody(raw: string): string {
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const filtered: string[] = [];

  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (isForwardHeaderLine(lower) || isNoiseLine(line)) {
      continue;
    }
    const noUrls = stripUrls(line);
    const normalized = noUrls.replace(/\s{2,}/g, " ").trim();
    filtered.push(normalized);
  }

  while (filtered.length && !filtered[0].trim()) {
    filtered.shift();
  }

  let startIdx = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    if (seemsContentLine(filtered[i])) {
      startIdx = i;
      break;
    }
  }

  const cleaned: string[] = [];
  for (const line of filtered.slice(startIdx)) {
    const lower = line.trim().toLowerCase();
    if (isFooterLine(lower)) break;
    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function countWords(text: string): number {
  const matches = text.match(/\b\w+\b/g);
  return matches ? matches.length : 0;
}

function bodyWorthUpload(cleaned: string): boolean {
  return countWords(cleaned) >= MIN_CLEAN_WORDS_FOR_UPLOAD;
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

function toTextFilename(subject: string | undefined, messageId: string): string {
  const base = (subject || "email").trim().slice(0, 60) || "email";
  const sanitized = base.replace(/[^\w.\-]+/g, "_");
  return `${sanitized}-${messageId}.txt`;
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
  let textUploads = 0;
  let totalCandidates = 0;
  let skippedEmails = 0;
  const createdArticleIds: string[] = [];

  for (const messageId of messageIds) {
    let payload: gmail_v1.Schema$MessagePart | undefined;
    let headers: gmail_v1.Schema$MessagePartHeader[] = [];
    let subject = "";

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
    } catch (err) {
      console.error("Failed to fetch Gmail message", messageId, err);
      skippedEmails += 1;
      continue;
    }

    const rawBody = extractBody(payload);
    const cleanedBody = cleanBody(rawBody);
    const pdfAttachments = await fetchPdfAttachments(
      gmailClient,
      messageId,
      payload
    );

    const filesForEmail: { name: string; data: Buffer; type: "pdf" | "text" }[] =
      [];

    if (pdfAttachments.length) {
      for (const file of pdfAttachments) {
        filesForEmail.push({ ...file, type: "pdf" });
      }
    } else if (bodyWorthUpload(cleanedBody)) {
      filesForEmail.push({
        name: safeFilename(
          toTextFilename(subject, messageId),
          `${messageId}.txt`
        ),
        data: Buffer.from(cleanedBody, "utf-8"),
        type: "text",
      });
    }

    if (!filesForEmail.length) {
      skippedEmails += 1;
      continue;
    }

    totalCandidates += filesForEmail.length;

    for (const file of filesForEmail) {
      try {
        const { isDuplicate, article } = await addPdfFromBuffer(file.data, file.name);
        if (isDuplicate) {
          duplicates += 1;
          continue;
        }

        filesInserted += 1;
        if (article?.id) {
          createdArticleIds.push(article.id);
        }
        if (file.type === "pdf") {
          pdfUploads += 1;
        } else {
          textUploads += 1;
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
    textUploads,
    skippedEmails,
    totalCandidates,
    createdArticleIds,
  };
}
