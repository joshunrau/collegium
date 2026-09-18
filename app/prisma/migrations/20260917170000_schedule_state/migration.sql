-- TriggerSource gains `cron`. The column is TEXT with no CHECK constraint, so the guarantee is the
-- client's and nothing on disk changes.

-- CreateTable
CREATE TABLE "ScheduleState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredFor" DATETIME
);
