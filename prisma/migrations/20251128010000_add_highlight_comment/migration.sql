-- Align highlight schema with current app expectations
ALTER TABLE "NewsHighlight"
  DROP COLUMN IF EXISTS "source",
  ADD COLUMN IF NOT EXISTS "comment" TEXT,
  ALTER COLUMN "userId" SET NOT NULL;
