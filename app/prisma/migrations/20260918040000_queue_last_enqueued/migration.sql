-- SQLite refuses `ALTER TABLE … ADD COLUMN` for a `NOT NULL` column with no default, so the table is
-- rebuilt, as prisma migrate itself does for such a change. The copy fills `lastEnqueuedAt` from
-- `createdAt`: the stamp only has to change on every later write to the row, which is how a consume
-- in flight learns the entry moved under it (§5.2), and the row's creation is the last write the
-- store can vouch for.
PRAGMA foreign_keys=OFF;

-- CreateTable
CREATE TABLE "new_QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "earliestUnprocessedPostId" TEXT NOT NULL,
    "lastEnqueuedAt" DATETIME NOT NULL
);
INSERT INTO "new_QueueEntry" ("id", "agentUsername", "channelId", "createdAt", "earliestUnprocessedPostId", "lastEnqueuedAt")
SELECT "id", "agentUsername", "channelId", "createdAt", "earliestUnprocessedPostId", "createdAt" FROM "QueueEntry";
DROP TABLE "QueueEntry";
ALTER TABLE "new_QueueEntry" RENAME TO "QueueEntry";

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_agentUsername_channelId_key" ON "QueueEntry"("agentUsername", "channelId");

PRAGMA foreign_keys=ON;
