/**
 * §3.8 — the share of a turn's ceiling one result may take as it arrives: longer, it enters as a view of
 * its first part with a reference to the rest. A share, because ceilings differ by deployment and
 * model, and "one arrival takes at most this much of the turn's room" must hold in each.
 */
export const RESULT_VIEW_SHARE = 0.15;

/**
 * §3.8 — the most one view may take whatever the ceiling, since a ceiling near a model's window would
 * otherwise admit arrivals re-sent at full size on every later completion.
 */
export const RESULT_VIEW_MAX_TOKENS = 30_000;

/**
 * §3.8 — how far relief under pressure brings a turn's context below its ceiling, in one pass. A
 * collapse edits an early message and bills everything after it uncached, so freeing a quarter of
 * the ceiling at once buys room for many completions where collapsing just enough would break the
 * cached prefix on nearly every one.
 */
export const RELIEF_LOW_WATER_SHARE = 0.75;

/** §3.8 — the least of a result a view is shortened to under pressure; below it a result shows only its size and reference */
export const RESULT_MIN_TOKENS = 500;
