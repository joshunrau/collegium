-- AlterTable
-- §7.4 — every turn recorded before chain length existed is treated as the start of its own chain
ALTER TABLE "Turn" ADD COLUMN "chainLength" INTEGER NOT NULL DEFAULT 1;
