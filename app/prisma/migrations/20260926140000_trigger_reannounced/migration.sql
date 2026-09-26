-- §7.3 — a trigger whose turn a restart abandoned before it had effects is announced again, and
-- after an unclean stop at most once across crashes; this records that it was.
ALTER TABLE "Trigger" ADD COLUMN "reannouncedAt" DATETIME;
