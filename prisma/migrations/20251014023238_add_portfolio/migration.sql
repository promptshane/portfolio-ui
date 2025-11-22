/*
  Warnings:

  - You are about to drop the `WatchlistItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `createdAt` on the `Holding` table. All the data in the column will be lost.
  - You are about to drop the column `symbol` on the `Holding` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Holding` table. All the data in the column will be lost.
  - You are about to alter the column `shares` on the `Holding` table. The data in that column could be lost. The data in that column will be cast from `Float` to `Int`.
  - Added the required column `sym` to the `Holding` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_phone_key";

-- DropIndex
DROP INDEX "WatchlistItem_userId_symbol_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WatchlistItem";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Holding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "sym" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "avgCost" REAL NOT NULL,
    CONSTRAINT "Holding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Holding" ("avgCost", "id", "shares", "userId") SELECT "avgCost", "id", "shares", "userId" FROM "Holding";
DROP TABLE "Holding";
ALTER TABLE "new_Holding" RENAME TO "Holding";
CREATE UNIQUE INDEX "Holding_userId_sym_key" ON "Holding"("userId", "sym");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
