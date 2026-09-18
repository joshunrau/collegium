/**
 * §7.3 — the whole of what boot waits for every credential probe together. Past it an unanswered
 * probe is unverified rather than refused: a provider that never answers must neither hold the
 * deployment nor be read as a bad key.
 */
export const CREDENTIAL_PROBE_DEADLINE_MS = 30_000;
