// src/app/api/news/articles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  deletePdf,
  getArticleById,
  markArticleViewed,
} from "@/server/news/store";
import {
  loadQaHistoryForUser,
  appendQaEntriesForUser,
  deleteQuestionForUser,
  type QaEntry,
} from "@/server/news/questions";
import {
  generateAndStoreSummary,
  answerQuestionsForArticle,
} from "@/server/news/summarizer";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const articleId = (id || "").trim();
  const article = await getArticleById(articleId);

  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load any saved Q&A history for the current user (if logged in)
  const session = await getServerSession(authOptions);
  const uid = Number((session as any)?.user?.id) || 0;

  let qaHistory: QaEntry[] = [];
  if (uid) {
    qaHistory = await loadQaHistoryForUser(article.id, uid);
  }

  return NextResponse.json({
    id: article.id,
    originalFilename: article.originalFilename,
    uploadedAt: article.uploadedAt.toISOString(),
    hasSummary: article.hasSummary,
    qaHistory,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deletePdf((id || "").trim());
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("Error deleting PDF:", err);
    return NextResponse.json(
      { error: "Failed to delete PDF." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const articleId = (id || "").trim();

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // allow empty / invalid JSON; default action handled below
    }

    const action =
      body && typeof body.action === "string" ? body.action : "summarize";

    // Summarization
    if (action === "summarize") {
      const summary = await generateAndStoreSummary(articleId);

      return NextResponse.json(
        {
          status: "ok",
          summary,
        },
        { status: 200 }
      );
    }

    // Mark an article as viewed for this user
    if (action === "markViewed") {
      const session = await getServerSession(authOptions);
      const uid = Number((session as any)?.user?.id) || 0;

      // If we don't know who the user is, just no-op but return ok
      if (uid) {
        await markArticleViewed(articleId, uid);
      }

      return NextResponse.json({ status: "ok" }, { status: 200 });
    }

    // Delete a stored question (and its answer) for this article/user
    if (action === "deleteQuestion") {
      const session = await getServerSession(authOptions);
      const uid = Number((session as any)?.user?.id) || 0;

      // If we don't know who the user is, there's nothing to delete server-side.
      if (!uid) {
        return NextResponse.json({ status: "ok" }, { status: 200 });
      }

      const rawId =
        typeof body?.questionId === "string" ? body.questionId : "";
      const questionId = rawId.trim();

      if (!questionId) {
        return NextResponse.json(
          { error: "No questionId provided to delete." },
          { status: 400 }
        );
      }

      const updatedHistory = await deleteQuestionForUser(
        articleId,
        uid,
        questionId
      );

      return NextResponse.json(
        { status: "ok", qaHistory: updatedHistory },
        { status: 200 }
      );
    }

    // Q&A: treat "qa" and legacy "ask" as equivalent
    if (action === "qa" || action === "ask") {
      const rawQuestions: unknown[] = Array.isArray(body?.questions)
        ? body.questions
        : [];
      const questions = rawQuestions
        .filter((q: unknown): q is string => typeof q === "string")
        .map((q) => q.trim())
        .filter((q) => q.length > 0);

      if (!questions.length) {
        return NextResponse.json(
          { error: "No questions provided." },
          { status: 400 }
        );
      }

      // Call the model to answer questions based on this article's PDF
      const answers = await answerQuestionsForArticle(articleId, questions);

      // Append to QA history in the DB for this user, if logged in
      const session = await getServerSession(authOptions);
      const uid = Number((session as any)?.user?.id) || 0;

      if (uid) {
        const now = new Date();
        const baseId = now.getTime().toString(36);

        const newEntries: QaEntry[] = answers.map((a, idx) => ({
          id: `${baseId}-${idx}`,
          userId: uid,
          question: a.question,
          answer: a.answer,
          status: "answered",
          createdAtISO: now.toISOString(),
          answeredAtISO: now.toISOString(),
        }));

        await appendQaEntriesForUser(articleId, uid, newEntries);
      }

      // Return just the answers in the shape the News page expects
      return NextResponse.json(
        {
          status: "ok",
          answers,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: "Unsupported action" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Error in article POST action:", err);
    return NextResponse.json(
      { error: "Failed to process article action." },
      { status: 500 }
    );
  }
}
