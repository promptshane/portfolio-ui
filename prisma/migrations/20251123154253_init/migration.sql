-- CreateEnum
CREATE TYPE "ColorPalette" AS ENUM ('classic', 'icy', 'violet', 'luxe', 'blueAmberTeal', 'crimsonVioletMint');

-- CreateEnum
CREATE TYPE "NewsBatchType" AS ENUM ('summarize', 'resummarize', 'refresh');

-- CreateEnum
CREATE TYPE "NewsBatchStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "preferredName" TEXT,
    "hashedPassword" TEXT,
    "password" TEXT,
    "colorPalette" "ColorPalette" NOT NULL DEFAULT 'classic',
    "verifiedEmailsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "sym" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "avgCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfPath" TEXT NOT NULL,
    "hasSummary" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "author" TEXT,
    "datePublished" TIMESTAMP(3),
    "summaryText" TEXT,
    "keyPointsJson" TEXT,
    "actionsJson" TEXT,
    "tickersJson" TEXT,
    "summarizedAt" TIMESTAMP(3),
    "qaHistoryJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsQuestion" (
    "id" SERIAL NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticleView" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticleView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" SERIAL NOT NULL,
    "followerId" INTEGER NOT NULL,
    "followingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubRepost" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "tickersJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubRepost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverseerLink" (
    "id" SERIAL NOT NULL,
    "overseerId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverseerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsBatchJob" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NewsBatchType" NOT NULL,
    "status" "NewsBatchStatus" NOT NULL DEFAULT 'pending',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "criteriaJson" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsBatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_userId_sym_key" ON "Holding"("userId", "sym");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_symbol_key" ON "WatchlistItem"("userId", "symbol");

-- CreateIndex
CREATE INDEX "NewsQuestion_articleId_userId_createdAt_idx" ON "NewsQuestion"("articleId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticleView_userId_articleId_key" ON "NewsArticleView"("userId", "articleId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "HubRepost_articleId_idx" ON "HubRepost"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "HubRepost_userId_articleId_key" ON "HubRepost"("userId", "articleId");

-- CreateIndex
CREATE UNIQUE INDEX "OverseerLink_overseerId_targetId_key" ON "OverseerLink"("overseerId", "targetId");

-- CreateIndex
CREATE INDEX "NewsBatchJob_userId_status_createdAt_idx" ON "NewsBatchJob"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsQuestion" ADD CONSTRAINT "NewsQuestion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsQuestion" ADD CONSTRAINT "NewsQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleView" ADD CONSTRAINT "NewsArticleView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleView" ADD CONSTRAINT "NewsArticleView_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubRepost" ADD CONSTRAINT "HubRepost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubRepost" ADD CONSTRAINT "HubRepost_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverseerLink" ADD CONSTRAINT "OverseerLink_overseerId_fkey" FOREIGN KEY ("overseerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverseerLink" ADD CONSTRAINT "OverseerLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsBatchJob" ADD CONSTRAINT "NewsBatchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

