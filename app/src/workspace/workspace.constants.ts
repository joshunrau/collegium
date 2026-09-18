/** How many bytes of a file `workspace::grep` inspects for a NUL before treating it as binary and skipping it. */
export const BINARY_PROBE_BYTES = 8_192;

/** How many matching lines `workspace::grep` returns per file by default, and the most it will accept. */
export const GREP_DEFAULT_MATCHES = 20;
export const GREP_MAX_MATCHES = 200;

/**
 * Longest `list`, `find`, `grep` or `stat` output fed back to the model; the rest is dropped with a
 * marker. Equal to the shell's `OUTPUT_CAP_CHARS`, so a listing costs what a shell listing would.
 */
export const LISTING_CAP_CHARS = 8_192;

/** The most of one file `workspace::read` returns, in characters; beyond it the text is cut with a marker. */
export const READ_CAP_CHARS = 200_000;

/** How many directory levels a walk descends by default, and the most `workspace::find` will accept. */
export const WALK_DEFAULT_DEPTH = 4;
export const WALK_MAX_DEPTH = 12;

/**
 * How many entries one `workspace::find` or `workspace::grep` walk visits before it stops and says
 * so. An in-process read has no `timeout(1)` behind it, so the bound on a walk is the walk itself.
 */
export const WALK_MAX_ENTRIES = 2_000;
