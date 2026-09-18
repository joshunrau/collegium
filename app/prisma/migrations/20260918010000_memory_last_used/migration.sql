-- AlterTable
ALTER TABLE "Memory" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill, written by hand: the column default alone would stamp every existing row with one
-- identical timestamp, and the first eviction after this migration would then pick arbitrarily.
UPDATE "Memory" SET "lastUsedAt" = "createdAt";

-- CreateIndex
CREATE INDEX "Memory_agentUsername_lastUsedAt_idx" ON "Memory"("agentUsername", "lastUsedAt");
