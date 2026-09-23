-- AlterTable
ALTER TABLE "Post" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Post_channelId_isPinned_idx" ON "Post"("channelId", "isPinned");
