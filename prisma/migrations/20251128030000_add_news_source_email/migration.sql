-- Track source email for news articles to enforce access control
ALTER TABLE "NewsArticle" ADD COLUMN "sourceEmail" TEXT;
