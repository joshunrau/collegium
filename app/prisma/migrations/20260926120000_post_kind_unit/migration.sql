-- PostKind gains `unit` (§3.15). The column is TEXT with no CHECK constraint, so the guarantee is
-- the client's; the assignments, reports and closes already recorded as notices are reclassified by
-- their fixed headings, which no failure notice carries, so search (§3.8) finds them.
UPDATE "Post" SET "kind" = 'unit'
WHERE "kind" = 'notice' AND "authorKind" = 'agent' AND (
  "message" LIKE '@% — work unit `%'
  OR "message" LIKE '@% — unit `%` is ready for review: %'
  OR "message" LIKE '@% — unit `%` is blocked: %'
  OR "message" LIKE 'Unit `%` closed as %'
);
