-- WorkUnitState is TEXT with no CHECK constraint, so the guarantee is the client's.

-- CreateTable
CREATE TABLE "WorkUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assigneeUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "closedAt" DATETIME,
    "context" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorUsername" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "lastPostId" TEXT NOT NULL,
    "originPostId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WorkUnit_channelId_state_idx" ON "WorkUnit"("channelId", "state");

-- CreateIndex
CREATE INDEX "WorkUnit_channelId_creatorUsername_idx" ON "WorkUnit"("channelId", "creatorUsername");

-- CreateIndex
CREATE INDEX "WorkUnit_channelId_assigneeUsername_idx" ON "WorkUnit"("channelId", "assigneeUsername");
