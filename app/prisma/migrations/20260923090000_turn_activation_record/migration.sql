-- AlterTable
ALTER TABLE "Turn" ADD COLUMN "activationKind" TEXT;
ALTER TABLE "Turn" ADD COLUMN "contextAssembledAt" DATETIME;
ALTER TABLE "Turn" ADD COLUMN "drainedFromPostId" TEXT;
ALTER TABLE "Turn" ADD COLUMN "windowEstimatedTokens" INTEGER;
ALTER TABLE "Turn" ADD COLUMN "windowOldestAt" DATETIME;

-- TurnEventKind gains `output_rejected` (§8.3). The column is TEXT with no CHECK constraint, so the
-- guarantee is the client's and nothing on disk changes.
