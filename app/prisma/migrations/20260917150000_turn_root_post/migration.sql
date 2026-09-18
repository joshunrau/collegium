-- AlterTable
ALTER TABLE "Turn" ADD COLUMN "rootPostId" TEXT;

-- CreateIndex
CREATE INDEX "Turn_rootPostId_idx" ON "Turn"("rootPostId");
