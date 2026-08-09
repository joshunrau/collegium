-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorKind" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "isForgotten" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authoringTurnId" TEXT,
    CONSTRAINT "Post_authoringTurnId_fkey" FOREIGN KEY ("authoringTurnId") REFERENCES "Turn" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "agentUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "completionTokens" INTEGER,
    "depth" INTEGER NOT NULL,
    "endedAt" DATETIME,
    "modelName" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "statusPostId" TEXT,
    "triggeringPostId" TEXT
);

-- CreateTable
CREATE TABLE "TurnEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "turnId" TEXT NOT NULL,
    CONSTRAINT "TurnEvent_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "args" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedByUsername" TEXT,
    "payloadText" TEXT NOT NULL,
    "promptPostId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    CONSTRAINT "Approval_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,
    "postId" TEXT,
    "postedAt" DATETIME,
    "reference" JSONB NOT NULL,
    "resolvedAt" DATETIME,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetAgentUsername" TEXT NOT NULL,
    "targetChannelId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MailCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "earliestUnprocessedPostId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PluginRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "pluginName" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "originPostId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentUsername" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Post_channelId_createdAt_idx" ON "Post"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "Turn_agentUsername_channelId_startedAt_idx" ON "Turn"("agentUsername", "channelId", "startedAt");

-- CreateIndex
CREATE INDEX "Turn_status_idx" ON "Turn"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TurnEvent_turnId_sequence_key" ON "TurnEvent"("turnId", "sequence");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Trigger_dedupeKey_key" ON "Trigger"("dedupeKey");

-- CreateIndex
CREATE INDEX "Trigger_targetAgentUsername_status_idx" ON "Trigger"("targetAgentUsername", "status");

-- CreateIndex
CREATE INDEX "Trigger_targetChannelId_status_idx" ON "Trigger"("targetChannelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MailCursor_agentUsername_key" ON "MailCursor"("agentUsername");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_agentUsername_channelId_key" ON "QueueEntry"("agentUsername", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginRecord_pluginName_collection_key_key" ON "PluginRecord"("pluginName", "collection", "key");

-- CreateIndex
CREATE INDEX "Memory_agentUsername_createdAt_idx" ON "Memory"("agentUsername", "createdAt");

-- CreateIndex
CREATE INDEX "Episode_agentUsername_channelId_createdAt_idx" ON "Episode"("agentUsername", "channelId", "createdAt");
