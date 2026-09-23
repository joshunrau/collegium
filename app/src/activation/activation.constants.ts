/** the §5.2 receipt: the reaction an agent leaves on a post it has queued rather than answered */
export const QUEUED_ACKNOWLEDGEMENT_EMOJI = 'eyes';

/** §8.3 — why a post that is work for the agent went into its queue rather than starting a turn, as the log names it */
export const QUEUE_REASONS = {
  busy: 'its turn here holds the lane (§5.1)',
  ceiling: 'the hourly turn ceiling refused a turn (§7.4)',
  halted: 'the framework is halted (§7.4)',
  handoff: 'the turn that addressed it stopped acting while its own turn holds the lane (§5.2)',
  resync: 'a reconnect recovered it (§5.2)'
} as const;
