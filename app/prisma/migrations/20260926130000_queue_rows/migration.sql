-- The queue holds one row per queued post (§5.2) rather than one pointer per lane, so the table is
-- rebuilt. Each standing pointer becomes one row for the post it named, queued when it was last
-- written; the window carries whatever else the pointer covered. A pointer narrowed this way drains
-- without the posts behind it, so this deploys with no standing queue (§8.4 discards one first).
PRAGMA foreign_keys=OFF;

-- CreateTable
CREATE TABLE "new_QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enqueuedAt" DATETIME NOT NULL,
    "postId" TEXT NOT NULL,
    "returnedOnce" BOOLEAN NOT NULL DEFAULT false,
    "takenByTurnId" TEXT
);
INSERT INTO "new_QueueEntry" ("id", "agentUsername", "channelId", "enqueuedAt", "postId")
SELECT "id", "agentUsername", "channelId", "lastEnqueuedAt", "earliestUnprocessedPostId" FROM "QueueEntry";
DROP TABLE "QueueEntry";
ALTER TABLE "new_QueueEntry" RENAME TO "QueueEntry";

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_agentUsername_channelId_postId_key" ON "QueueEntry"("agentUsername", "channelId", "postId");

PRAGMA foreign_keys=ON;
