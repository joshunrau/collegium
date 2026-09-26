/** §7.3 — what a restart ran again, and what it did not, for the boot notice to say */
export type RestartRequeue = {
  /** posts not queued again: their turns were cut off by an unclean stop after a completion, twice */
  readonly notQueuedPostIds: readonly string[];
  /** abandoned turns that had no effects, whose posts or trigger went back to be answered */
  readonly requeuedTurns: number;
  /** triggers left posted rather than announced again, for the same reason */
  readonly unannouncedTriggerIds: readonly string[];
};
