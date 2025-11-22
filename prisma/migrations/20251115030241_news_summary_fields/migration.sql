-- AlterTable
ALTER TABLE "NewsArticle" ADD COLUMN "actionsJson" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "author" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "datePublished" DATETIME;
ALTER TABLE "NewsArticle" ADD COLUMN "keyPointsJson" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "qaHistoryJson" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "summarizedAt" DATETIME;
ALTER TABLE "NewsArticle" ADD COLUMN "summaryText" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "tickersJson" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "title" TEXT;
