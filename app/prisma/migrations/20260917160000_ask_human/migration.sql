-- CreateTable
CREATE TABLE "Ask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "answerText" TEXT,
    "answeredAt" DATETIME,
    "answeredByUsername" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "options" JSONB,
    "promptPostId" TEXT,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolNamespace" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    CONSTRAINT "Ask_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ask_status_idx" ON "Ask"("status");
