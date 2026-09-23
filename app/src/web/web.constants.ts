/**
 * The ceiling on one fetched page, in characters — roughly 250k tokens at this codebase's 4:1
 * estimate, and nearer 300k for link-dense markdown, where URLs and addresses tokenise poorly.
 *
 * A resource guard, not an editorial cap: real directory pages run 20–40k, so nothing legitimate
 * comes near it. What it catches is a log dump, a generated file, or a tarpit — and those are cut
 * with a visible marker, so the model knows it is holding a partial page rather than the whole one.
 */
export const MARKDOWN_CAP_CHARS = 1_000_000;

/**
 * How much of a page one fetch returns when it names no width. Most pages fit whole; a longer one
 * is read on in windows or searched with `find`, since what a result holds past what the model
 * needed is paid for again at each later step of the turn (§3.4).
 */
export const DEFAULT_WINDOW_CHARS = 30_000;

/** how much of the page a `find` hit shows on each side of the match: a label and the field beside it */
export const FIND_CONTEXT_CHARS = 250;

/** how many places a `find` shows for one phrase; the rest are counted, since a narrower phrase finds them */
export const FIND_HITS_PER_PHRASE = 5;

/** the ceiling on one navigation — generous, because slow public sites are the normal case, not the exception */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * How long a capture waits for a tab the page opened to commit a navigation, so its address can be
 * reported. Short, because the tab is closed regardless and the wait sits inside the action's
 * timeout; a popup that has not committed by then is reported without an address.
 */
export const OPENED_TAB_URL_TIMEOUT_MS = 2_000;

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

/** how many of a select's options a snapshot lists; a country list runs to a few hundred, and the rest are counted */
export const SELECT_OPTIONS_SHOWN = 100;

/** the ceiling on one plain fetch — tighter than a navigation, since nothing renders after the bytes arrive */
export const FETCH_TIMEOUT_MS = 20_000;

/**
 * The pause before retrying a 429 that names none (§3.4). Most limits are counted per second, so
 * one second has let the window pass; a 503 that names none is not retried at all, since it is as
 * likely an outage or a CDN's refusal as a request to slow down.
 */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 1_000;

/**
 * How much of its request's timeout a retried request must still have to answer in once the wait
 * is over (§3.4). A longer wait is not taken: a retry the timeout cuts off reads as a page that
 * failed to load, where the status it replaced was one the model could plan around.
 */
export const RATE_LIMIT_RETRY_MIN_ANSWER_MS = 10_000;

/**
 * Wikimedia and other robot-policy hosts refuse an unnamed client with a 403; a named one is what
 * their policy asks for. No deployment name, since the header reaches every site an agent reads.
 */
export const FETCH_USER_AGENT = 'Collegium (+https://github.com/joshunrau/collegium)';

/**
 * The ceiling on one fetched body, in bytes — a resource guard on the read, before conversion,
 * where a tarpit would otherwise be buffered whole. Past it the body is cut and the page says so.
 */
export const FETCH_BODY_CAP_BYTES = 10_000_000;

/**
 * The ceiling on reading one PDF's text layer, waiting for a turn to read included, past which the
 * process reading it is killed and the pages it finished are kept. A few pages read in well under a
 * second; what this catches is a document of tens of thousands of pages, whose parse would
 * otherwise outlast the tool call.
 */
export const PDF_READ_TIMEOUT_MS = 10_000;

/**
 * The resident memory the process reading one PDF may reach before it is killed (§3.4). A typical
 * paper takes about 120 MB, most of it the reader's own code; what this stops is a compressed stream
 * a megabyte long that inflates to gigabytes inside the parser.
 */
export const PDF_READ_MEMORY_CAP_BYTES = 500_000_000;

/** how many PDFs are read at once (§3.4), so that the cap above bounds their sum as well as each one */
export const PDF_READS_AT_ONCE = 2;

/** each hop is re-judged against the URL policy, so a chain is bounded rather than followed blindly */
export const MAX_REDIRECTS = 5;
