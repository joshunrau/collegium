-- CreateTable
CREATE TABLE "ResumeWatermark" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "resumedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Turn_startedAt_idx" ON "Turn"("startedAt");
