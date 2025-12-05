-- Add GPT-driven storage decision and quality metadata to news articles
ALTER TABLE "NewsArticle" ADD COLUMN "storageDecision" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "qualityTag" TEXT;
ALTER TABLE "NewsArticle" ADD COLUMN "qualityNote" TEXT;
