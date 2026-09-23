-- PostKind gains `prompt` (§4.5). The column is TEXT with no CHECK constraint, so the guarantee is
-- the client's; the approval and ask prompts already recorded as notices are reclassified, so a
-- restart's recomputed hold (§7.3) reads them as the prompts they are.
UPDATE "Post" SET "kind" = 'prompt' WHERE "id" IN (SELECT "promptPostId" FROM "Approval" WHERE "promptPostId" IS NOT NULL);
UPDATE "Post" SET "kind" = 'prompt' WHERE "id" IN (SELECT "promptPostId" FROM "Ask" WHERE "promptPostId" IS NOT NULL);
