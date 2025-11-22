-- CreateTable
CREATE TABLE "WatchItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WatchItem_userId_idx" ON "WatchItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchItem_userId_symbol_key" ON "WatchItem"("userId", "symbol");
