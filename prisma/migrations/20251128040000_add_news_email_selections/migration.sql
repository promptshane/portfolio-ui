-- Store user-selected verified emails for news visibility
ALTER TABLE "User" ADD COLUMN "newsEmailSelectionsJson" TEXT;
