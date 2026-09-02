/**
 * The ceiling on one fetched page, in characters — roughly 250k tokens at this codebase's 4:1
 * estimate, and nearer 300k for link-dense markdown, where URLs and addresses tokenise poorly.
 *
 * A resource guard, not an editorial cap: real directory pages run 20–40k, so nothing legitimate
 * comes near it. What it catches is a log dump, a generated file, or a tarpit — and those are cut
 * with a visible marker, so the model knows it is holding a partial page rather than the whole one.
 */
export const MARKDOWN_CAP_CHARS = 1_000_000;

/** the ceiling on one navigation — generous, because slow public sites are the normal case, not the exception */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** how long a click or fill waits for its element to become actionable before the failure is reported */
export const ACTION_TIMEOUT_MS = 5_000;

/**
 * The post-action quiet period: network idle for this long counts as "settled". Capped so a
 * long-polling page cannot hold a turn hostage — when the cap trips, the capture proceeds with
 * whatever has rendered.
 */
export const NETWORK_IDLE_TIMEOUT_MS = 3_000;

/**
 * How long the document must go unchanged before the capture counts the page as done rendering.
 */
export const DOM_QUIET_MS = 250;

/**
 * The floor on that wait. An idle DOM is not evidence a page has finished: between the click and
 * the timer that renders the next view, there is nothing to observe. So every action gives the
 * page this long to start reacting — the cost of catching a deferred render without asking the
 * model to know one is coming. A page that reacts later than this needs the deadline below.
 */
export const DOM_SETTLE_MIN_MS = 750;

/**
 * The ceiling on waiting for that quiet period. A page that animates never stops mutating, so the
 * wait ends here and the capture proceeds with whatever has rendered — the same bargain the
 * network-idle cap makes.
 */
export const DOM_SETTLE_TIMEOUT_MS = 3_000;

/**
 * The ceiling on concurrently live sessions — a memory guard, since each is a Firefox context
 * holding a rendered page. Turns beyond it get the `busy` failure rather than a queue, because a
 * blocked queue inside a turn is a stall the model cannot see.
 */
export const MAX_LIVE_SESSIONS = 4;

/** the ceiling on one plain fetch — tighter than a navigation, since nothing renders after the bytes arrive */
export const FETCH_TIMEOUT_MS = 20_000;

/**
 * The ceiling on one fetched body, in bytes — a resource guard on the read, before conversion,
 * where a tarpit would otherwise be buffered whole. Past it the body is cut and the page says so.
 */
export const FETCH_BODY_CAP_BYTES = 10_000_000;

/** each hop is re-judged against the URL policy, so a chain is bounded rather than followed blindly */
export const MAX_REDIRECTS = 5;
