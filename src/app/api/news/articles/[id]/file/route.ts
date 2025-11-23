// src/app/api/news/articles/[id]/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getArticleById, readPdfBuffer } from "@/server/news/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const articleId = (id || "").trim();
    const article = await getArticleById(articleId);

    if (!article) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const fileBuffer = await readPdfBuffer(articleId);

    const filename =
      article.originalFilename && article.originalFilename.trim().length > 0
        ? article.originalFilename
        : `${article.id}.pdf`;

    const storedExt = path.extname(article.pdfPath || "").toLowerCase();
    const contentType =
      storedExt === ".txt" ? "text/plain; charset=utf-8" : "application/pdf";

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          filename
        )}"`,
        "Content-Length": String(fileBuffer.length),
      },
    });
  } catch (err) {
    console.error("Error in article file download route:", err);
    return NextResponse.json(
      { error: "Failed to download PDF." },
      { status: 500 }
    );
  }
}
