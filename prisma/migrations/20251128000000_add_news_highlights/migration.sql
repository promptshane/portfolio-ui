-- CreateTable
CREATE TABLE "NewsHighlight" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "rectsJson" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsHighlight_articleId_userId_idx" ON "NewsHighlight"("articleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsHighlight_userId_articleId_signature_key" ON "NewsHighlight"("userId", "articleId", "signature");

-- AddForeignKey
ALTER TABLE "NewsHighlight" ADD CONSTRAINT "NewsHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsHighlight" ADD CONSTRAINT "NewsHighlight_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
