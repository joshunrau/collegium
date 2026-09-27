-- §3.15 — every close records the state the unit closed from and what closed it; both stay null on a
-- unit closed before this migration. TEXT with no CHECK constraint, so the guarantee is the client's.
ALTER TABLE "WorkUnit" ADD COLUMN "closedFrom" TEXT;
ALTER TABLE "WorkUnit" ADD COLUMN "closedVia" TEXT;
