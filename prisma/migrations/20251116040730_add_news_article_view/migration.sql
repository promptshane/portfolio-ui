-- CreateTable
CREATE TABLE "NewsArticleView" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "firstViewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" DATETIME NOT NULL,
    CONSTRAINT "NewsArticleView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NewsArticleView_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticleView_userId_articleId_key" ON "NewsArticleView"("userId", "articleId");
