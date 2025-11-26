// src/server/news/summarizer.ts
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import prisma from "@/lib/prisma";
import { readPdfBuffer, getArticleById } from "./store";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type SummaryAction = {
  description: string;
  ticker: string;
};

export type SummaryTicker = {
  symbol: string;
  name: string;
  importance_rank: number;
  has_explicit_action: boolean;
};

export type SummaryPosition = {
  symbol: string;
  name: string;
  recommendation: string;
  allocation: number | null;
  entry_date: string;
  entry_price: number | null;
  current_price: number | null;
  return_pct: number | null;
  fair_value: number | null;
  stop_price: number | null;
  notes: string;
  as_of: string;
};

export type SummaryPayload = {
  title: string;
  date_published: string;
  author: string;
  summary: string;
  key_points: string[];
  actions: SummaryAction[];
  tickers: SummaryTicker[];
  positions: SummaryPosition[];
};

export type QaAnswer = {
  question: string;
  answer: string;
};

type ArticleModelInput =
  | { kind: "file"; fileId: string }
  | { kind: "text"; text: string };

async function prepareArticleModelInput(
  articleId: string
): Promise<ArticleModelInput> {
  const article = await getArticleById(articleId);
  if (!article) {
    throw new Error(`NewsArticle not found for id=${articleId}`);
  }

  const ext = (article.pdfPath && article.pdfPath.toLowerCase().endsWith(".txt")) ? ".txt" : ".pdf";
  const buffer = await readPdfBuffer(articleId);

  if (ext === ".txt") {
    const text = buffer.toString("utf-8");
    return {
      kind: "text",
      text: `Document contents (plain text):\n${text}`,
    };
  }

  const uploaded = await client.files.create({
    file: await toFile(buffer, `${articleId}.pdf`),
    purpose: "assistants",
  });

  return { kind: "file", fileId: uploaded.id };
}

const SUMMARY_PROMPT = `
You are a financial research summarization assistant. A user will provide an investment research document (PDF or plain text) as an input.

Read the entire document and produce a concise summary in the following JSON format:

{
  "title": "",
  "date_published": "",
  "author": "",
  "summary": "",
  "key_points": [],
  "actions": [
    {
      "description": "",
      "ticker": ""
    }
  ],
  "tickers": [
    {
      "symbol": "",
      "name": "",
      "importance_rank": 1,
      "has_explicit_action": true
    }
  ],
  "positions": [
    {
      "symbol": "",
      "name": "",
      "recommendation": "",
      "allocation": null,
      "entry_date": "",
      "entry_price": null,
      "current_price": null,
      "return_pct": null,
      "fair_value": null,
      "stop_price": null,
      "notes": "",
      "as_of": ""
    }
  ]
}

Rules:
- "title": Use the document title or a short, descriptive title.
- "date_published": Use the publication date and time of the research article as written near the title (for example: "Nov 12, 2025 3:00 PM"). 
  - Prefer the date/time explicitly associated with the publication ("Published", "Publication Date", issue header, etc.).
  - Ignore download/print timestamps or viewer metadata such as the time the PDF was generated or exported.
  - If only a calendar date is available, just return that date.
  - If the publication date truly cannot be determined, use an empty string "".
- "author": Extract the main author name if present; otherwise use an empty string "".
- "summary": 2-4 sentences capturing the core narrative of the article.
- "key_points": 3-7 bullet points (as plain strings) describing the most important ideas or arguments.
- "actions": Include only explicit investment actions such as Buy, Sell, Hold, Upgrade, Downgrade, Watch, Take profits, Trim, or similar. Each action should have:
    - "description": Short human-readable description (for example: "Buy Pfizer (PFE) under $60 and hold for the long term.")
    - "ticker": The related ticker symbol if clearly associated (for example "PFE"), otherwise use an empty string "".
  If there are no clear explicit actions, set "actions" to an empty list [].
- "tickers": Extract every distinct finance-related ticker symbol that appears in the JSON fields \`summary\`, \`key_points\`, or \`actions\` (either in the action "description" or in the action "ticker" field).
    - Do NOT include tickers that only appear elsewhere in the PDF if they are not present in those summary fields.
    - "symbol": The ticker symbol (e.g. "PFE").
    - "name": The company or ETF name if clearly available; otherwise an empty string "".
    - "importance_rank": An integer where 1 is the most important ticker in this document.
    - "has_explicit_action": true if this ticker also appears in the "actions" list with a non-empty ticker; otherwise false.
- "positions": If the document includes a position table (buy/hold/sell grid), extract each row with the following fields:
    - "symbol": ticker symbol (e.g., "EWG").
    - "name": company/ETF name.
    - "recommendation": Buy / Hold / Sell / Buy more / Stop triggered / similar.
    - "allocation": numeric percent allocation/weighting for the position (if shown).
    - "entry_date": the recommendation/reference date (issue date) as written.
    - "entry_price": price at that entry/reference date.
    - "current_price": current/latest price shown in the document.
    - "return_pct": percent gain/loss since entry (if shown).
    - "fair_value": Fair Trade Value / buy-up-to price (if present).
    - "stop_price": stop/exit price (if present).
    - "notes": short freeform notes (theme, adjustments, etc.) if present.
    - "as_of": the date the table represents (if stated separately).
  - If no such table exists, return "positions": [].
- If any field cannot be found in the document, fill it with an empty string "", an empty list [], or null as appropriate.
- Do not include any additional keys beyond those listed above.

Very important: Return ONLY the JSON object, with no extra commentary or explanation.
`;

const QA_PROMPT_TEMPLATE = `
You are an assistant helping a user understand a single investment-research document (PDF or plain text).

You will receive the PDF as a file plus a list of questions. Answer ONLY from the PDF.
If the PDF truly does not address a question, say briefly that the document does not say.

Return your answers in this JSON format:

[
  {
    "question": "<original question>",
    "answer": "<concise answer based only on the PDF>"
  }
]

The number of objects in the array must exactly match the number of questions provided,
and they must appear in the same order.
Questions:

{questions_block}
`;

// Normalize an author name so that all-caps or all-lowercase inputs become
// nicely cased (e.g. "DR. RACHEL EVERETT" -> "Dr. Rachel Everett").
function normalizeAuthorName(raw: any): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const allUpper = trimmed === trimmed.toUpperCase();
  const allLower = trimmed === trimmed.toLowerCase();

  // If it's already mixed-case, assume the source formatting is intentional.
  if (!allUpper && !allLower) {
    return trimmed;
  }

  const specials: Record<string, string> = {
    "dr": "Dr",
    "dr.": "Dr.",
    "mr": "Mr",
    "mr.": "Mr.",
    "mrs": "Mrs",
    "mrs.": "Mrs.",
    "ms": "Ms",
    "ms.": "Ms.",
    "jr": "Jr",
    "jr.": "Jr.",
    "sr": "Sr",
    "sr.": "Sr.",
    "ii": "II",
    "iii": "III",
    "iv": "IV",
  };

  const toWordCase = (word: string): string => {
    const lower = word.toLowerCase();
    if (specials[lower]) return specials[lower];

    // Handle hyphenated pieces like "smith-jones"
    if (lower.includes("-")) {
      return lower
        .split("-")
        .map((part) =>
          specials[part]
            ? specials[part]
            : part.charAt(0).toUpperCase() + part.slice(1)
        )
        .join("-");
    }

    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  return trimmed
    .split(/\s+/)
    .map((token) => toWordCase(token))
    .join(" ");
}

function normaliseSummary(raw: any): SummaryPayload {
  const keyPoints = Array.isArray(raw?.key_points)
    ? raw.key_points.map((v: any) => String(v))
    : [];

  const actions: SummaryAction[] = Array.isArray(raw?.actions)
    ? raw.actions.map((a: any) => ({
        description: typeof a?.description === "string" ? a.description : "",
        ticker: typeof a?.ticker === "string" ? a.ticker : "",
      }))
    : [];

  const summaryText =
    typeof raw?.summary === "string" ? raw.summary : "";

  const tickersRaw: SummaryTicker[] = Array.isArray(raw?.tickers)
    ? raw.tickers.map((t: any) => ({
        symbol: typeof t?.symbol === "string" ? t.symbol : "",
        name: typeof t?.name === "string" ? t.name : "",
        importance_rank:
          typeof t?.importance_rank === "number" ? t.importance_rank : 0,
        has_explicit_action: !!t?.has_explicit_action,
      }))
    : [];

  const positions: SummaryPosition[] = Array.isArray(raw?.positions)
    ? raw.positions.map((p: any) => ({
        symbol: typeof p?.symbol === "string" ? p.symbol : "",
        name: typeof p?.name === "string" ? p.name : "",
        recommendation: typeof p?.recommendation === "string" ? p.recommendation : "",
        allocation:
          typeof p?.allocation === "number"
            ? p.allocation
            : typeof p?.allocation === "string"
            ? Number(p.allocation.replace(/[^0-9.+-]/g, ""))
            : null,
        entry_date: typeof p?.entry_date === "string" ? p.entry_date : "",
        entry_price:
          typeof p?.entry_price === "number"
            ? p.entry_price
            : typeof p?.entry_price === "string"
            ? Number(p.entry_price.replace(/[^0-9.+-]/g, ""))
            : null,
        current_price:
          typeof p?.current_price === "number"
            ? p.current_price
            : typeof p?.current_price === "string"
            ? Number(p.current_price.replace(/[^0-9.+-]/g, ""))
            : null,
        return_pct:
          typeof p?.return_pct === "number"
            ? p.return_pct
            : typeof p?.return_pct === "string"
            ? Number(p.return_pct.replace(/[^0-9.+-]/g, ""))
            : null,
        fair_value:
          typeof p?.fair_value === "number"
            ? p.fair_value
            : typeof p?.fair_value === "string"
            ? Number(p.fair_value.replace(/[^0-9.+-]/g, ""))
            : null,
        stop_price:
          typeof p?.stop_price === "number"
            ? p.stop_price
            : typeof p?.stop_price === "string"
            ? Number(p.stop_price.replace(/[^0-9.+-]/g, ""))
            : null,
        notes: typeof p?.notes === "string" ? p.notes : "",
        as_of: typeof p?.as_of === "string" ? p.as_of : "",
      }))
    : [];

  // Build a combined text blob from the visible fields so we only keep
  // tickers that actually appear in summary, key points, or actions.
  const combinedTextParts: string[] = [];
  if (summaryText) combinedTextParts.push(summaryText);
  if (keyPoints.length) combinedTextParts.push(...keyPoints);
  if (actions.length) {
    combinedTextParts.push(
      ...actions.map((a) => `${a.description} ${a.ticker}`.trim())
    );
  }

  let filteredTickers = tickersRaw;
  if (combinedTextParts.length && tickersRaw.length) {
    const haystack = combinedTextParts.join(" \n ").toUpperCase();

    const escapeRegex = (sym: string) =>
      sym.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

    filteredTickers = tickersRaw.filter((t) => {
      const sym = (t.symbol || "").toUpperCase().trim();
      if (!sym) return false;
      const regex = new RegExp(`\\b${escapeRegex(sym)}\\b`, "i");
      return regex.test(haystack);
    });
  }

  const authorRaw =
    typeof raw?.author === "string" ? raw.author : "";

  return {
    title: typeof raw?.title === "string" ? raw.title : "",
    date_published:
      typeof raw?.date_published === "string" ? raw.date_published : "",
    author: normalizeAuthorName(authorRaw),
    summary: summaryText,
    key_points: keyPoints,
    actions,
    tickers: filteredTickers,
    positions,
  };
}

/**
 * Helper to pull plain text out of the Responses API result.
 */
function extractTextFromResponse(response: any): string | null {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  const outputs = response?.output;
  if (Array.isArray(outputs) && outputs.length > 0) {
    const chunks: string[] = [];
    for (const item of outputs) {
      if (!item?.content) continue;
      for (const block of item.content) {
        if (block?.type === "output_text" && block?.text) {
          if (typeof block.text === "string") {
            chunks.push(block.text);
          } else if (typeof block.text?.value === "string") {
            chunks.push(block.text.value);
          }
        } else if (typeof block?.text === "string") {
          chunks.push(block.text);
        }
      }
    }
    if (chunks.length) return chunks.join("\n");
  }

  return null;
}

export async function generateAndStoreSummary(
  articleId: string
): Promise<SummaryPayload> {
  const articleInput = await prepareArticleModelInput(articleId);

  const contentBlocks: Array<
    | { type: "input_file"; file_id: string }
    | { type: "input_text"; text: string }
  > = [];

  if (articleInput.kind === "file") {
    contentBlocks.push({ type: "input_file", file_id: articleInput.fileId });
  } else {
    contentBlocks.push({ type: "input_text", text: articleInput.text });
  }
  contentBlocks.push({ type: "input_text", text: SUMMARY_PROMPT });

  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: contentBlocks,
      },
    ],
  });

  const jsonText = extractTextFromResponse(response);
  if (!jsonText) {
    throw new Error("Summary model did not return any text output.");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse summary JSON:", err, jsonText);
    throw new Error("Model did not return valid JSON for summary.");
  }

  const summary = normaliseSummary(parsed);

  // Robust parsing for publication date:
  // - If it's a plain YYYY-MM-DD string, treat it as a local date (to avoid
  //   timezone shifting it into the previous day).
  // - Otherwise, let the JS Date parser handle the string.
  let datePublished: Date | null = null;
  if (summary.date_published) {
    const raw = summary.date_published.trim();
    let candidate: Date | null = null;

    const isoDateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnlyMatch) {
      const [, y, m, d] = isoDateOnlyMatch;
      // Local date; time doesn't matter, we just want the correct calendar day.
      candidate = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
    } else {
      const parsedDate = new Date(raw);
      if (!Number.isNaN(parsedDate.getTime())) {
        candidate = parsedDate;
      }
    }

    if (candidate && !Number.isNaN(candidate.getTime())) {
      datePublished = candidate;
    }
  }

  await prisma.newsArticle.update({
    where: { id: articleId },
    data: {
      hasSummary: true,
      title: summary.title,
      author: summary.author,
      datePublished,
      summaryText: summary.summary,
      keyPointsJson: JSON.stringify(summary.key_points),
      actionsJson: JSON.stringify(summary.actions),
      tickersJson: JSON.stringify(summary.tickers),
      discountJson: summary.positions?.length ? JSON.stringify(summary.positions) : null,
      summarizedAt: new Date(),
    },
  });

  // Persist structured positions for Discount Hub (best-effort; don't fail summary if table missing)
  try {
    const asOfFallback = datePublished ?? new Date();
    const toNumber = (value: number | null | undefined): number | null =>
      Number.isFinite(value ?? NaN) ? Number(value) : null;
    const parseDate = (value: string): Date | null => {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    await prisma.discountPosition.deleteMany({ where: { articleId } });
    if (Array.isArray(summary.positions) && summary.positions.length) {
      const rows = summary.positions
        .map((p) => {
          const symbol = (p.symbol || "").trim().toUpperCase();
          if (!symbol) return null;
          return {
            articleId,
            symbol,
            name: p.name?.trim() || null,
            recommendation: p.recommendation?.trim() || null,
            allocation: toNumber(p.allocation),
            entryDate: parseDate(p.entry_date),
            entryPrice: toNumber(p.entry_price),
            currentPrice: toNumber(p.current_price),
            returnPct: toNumber(p.return_pct),
            fairValue: toNumber(p.fair_value),
            stopPrice: toNumber(p.stop_price),
            notes: p.notes?.trim() || null,
            asOfDate: parseDate(p.as_of) ?? asOfFallback ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r);

      if (rows.length) {
        await prisma.discountPosition.createMany({ data: rows });
      }
    }
  } catch (err) {
    console.error("Discount position persistence failed (continuing):", err);
  }

  return summary;
}

export async function answerQuestionsForArticle(
  articleId: string,
  questions: string[]
): Promise<QaAnswer[]> {
  if (!questions.length) return [];

  const articleInput = await prepareArticleModelInput(articleId);

  const contentBlocks: Array<
    | { type: "input_file"; file_id: string }
    | { type: "input_text"; text: string }
  > = [];

  if (articleInput.kind === "file") {
    contentBlocks.push({ type: "input_file", file_id: articleInput.fileId });
  } else {
    contentBlocks.push({ type: "input_text", text: articleInput.text });
  }

  const questionsBlock = questions
    .map((q, idx) => `${idx + 1}. ${q}`)
    .join("\n");

  const prompt = QA_PROMPT_TEMPLATE.replace(
    "{questions_block}",
    questionsBlock
  );

  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          ...contentBlocks,
          { type: "input_text", text: prompt },
        ],
      },
    ],
  });

  const jsonText = extractTextFromResponse(response);
  if (!jsonText) {
    throw new Error("QA model did not return any text output.");
  }

  let raw: any;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse QA JSON:", err, jsonText);
    throw new Error("Model did not return valid JSON for Q&A.");
  }

  if (!Array.isArray(raw)) {
    return questions.map((q) => ({ question: q, answer: String(raw) }));
  }

  const answers: QaAnswer[] = [];
  for (let i = 0; i < questions.length; i++) {
    const item = raw[i];
    const answer =
      item && typeof item.answer === "string"
        ? item.answer
        : item
        ? String(item)
        : "";
    answers.push({ question: questions[i], answer });
  }

  return answers;
}
