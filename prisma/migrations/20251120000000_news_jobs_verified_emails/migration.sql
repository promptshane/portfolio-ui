-- Add verified sender storage on User
ALTER TABLE "User" ADD COLUMN "verifiedEmailsJson" TEXT;

-- Background job table for news batching
CREATE TABLE "NewsBatchJob" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "total" INTEGER NOT NULL DEFAULT 0,
  "completed" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT,
  "criteriaJson" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsBatchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "NewsBatchJob_userId_status_createdAt_idx"
  ON "NewsBatchJob" ("userId", "status", "createdAt");
