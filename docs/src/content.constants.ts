/**
 * Where the site's written pages live, relative to the package root. The loaders resolve it and
 * `source.ts` strips it back off to recover each file's place in the page tree, so the two must
 * agree on it.
 */
export const CONTENT_DIR = 'content';
