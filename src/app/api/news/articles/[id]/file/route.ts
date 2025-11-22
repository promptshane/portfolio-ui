// src/app/api/news/articles/[id]/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getArticleById, getPdfPath } from "@/server/news/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const article = await getArticleById(params.id);

    if (!article) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pdfPath = await getPdfPath(params.id);

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.promises.readFile(pdfPath);
    } catch (err) {
      console.error("Error reading PDF for download:", err);
      return NextResponse.json(
        { error: "PDF file not found on server." },
        { status: 404 }
      );
    }

    const filename =
      article.originalFilename && article.originalFilename.trim().length > 0
        ? article.originalFilename
        : `${article.id}.pdf`;

    const storedExt = path.extname(pdfPath).toLowerCase();
    const contentType =
      storedExt === ".txt" ? "text/plain; charset=utf-8" : "application/pdf";

    return new NextResponse(fileBuffer, {
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
