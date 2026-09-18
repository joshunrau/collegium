/**
 * The tick is far finer than the finest recurrence (a minute past some hour), so an occurrence is
 * announced within half a minute of coming due; announcing it later is the idle gate's business.
 */
export const SCHEDULE_TICK_MS = 30_000;
