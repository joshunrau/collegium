-- SQLite refuses `ALTER TABLE … ADD COLUMN` with a non-constant default once the table holds rows,
-- so the table is rebuilt, as prisma migrate itself does for such a change. The copy fills
-- `lastUsedAt` from `createdAt`: with one shared timestamp the first eviction after this migration
-- would pick arbitrarily, and behaviour must be exactly the old one until a body is read.
PRAGMA foreign_keys=OFF;

-- CreateTable
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originPostId" TEXT
);
INSERT INTO "new_Memory" ("id", "agentUsername", "body", "createdAt", "description", "lastUsedAt", "originPostId")
SELECT "id", "agentUsername", "body", "createdAt", "description", "createdAt", "originPostId" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";

-- CreateIndex
CREATE INDEX "Memory_agentUsername_createdAt_idx" ON "Memory"("agentUsername", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_agentUsername_lastUsedAt_idx" ON "Memory"("agentUsername", "lastUsedAt");

PRAGMA foreign_keys=ON;
