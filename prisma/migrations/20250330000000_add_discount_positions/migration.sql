-- Add discountJson column to NewsArticle
ALTER TABLE "NewsArticle" ADD COLUMN IF NOT EXISTS "discountJson" TEXT;

-- Create DiscountPosition table
CREATE TABLE IF NOT EXISTS "DiscountPosition" (
    "id" SERIAL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "recommendation" TEXT,
    "allocation" DOUBLE PRECISION,
    "entryDate" TIMESTAMP(3),
    "entryPrice" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION,
    "returnPct" DOUBLE PRECISION,
    "fairValue" DOUBLE PRECISION,
    "stopPrice" DOUBLE PRECISION,
    "notes" TEXT,
    "asOfDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Foreign key to NewsArticle
ALTER TABLE "DiscountPosition"
  ADD CONSTRAINT "DiscountPosition_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "DiscountPosition_symbol_createdAt_idx"
  ON "DiscountPosition"("symbol", "createdAt" DESC);
