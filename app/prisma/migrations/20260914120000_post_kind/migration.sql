-- AlterTable
ALTER TABLE "Post" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'message';

-- a status post is the one its turn recorded as such; every other post a turn authored is taken
-- as a reply, since a notice left nothing in history that tells it apart
UPDATE "Post" SET "kind" = 'status' WHERE "id" IN (SELECT "statusPostId" FROM "Turn" WHERE "statusPostId" IS NOT NULL);
UPDATE "Post" SET "kind" = 'reply' WHERE "kind" = 'message' AND "authoringTurnId" IS NOT NULL;
