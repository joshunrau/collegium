-- CreateTable
CREATE TABLE "Runtime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastAliveAt" DATETIME NOT NULL,
    "stoppedAt" DATETIME
);
