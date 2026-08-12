/**
 * How long provisioning waits for Mattermost to answer. Compose holds the app until Mattermost is
 * healthy, so this covers the gap between a passing healthcheck and a server ready to serve — and,
 * on a first start, a Postgres schema Mattermost is still creating.
 */
export const PROVISIONING_PING = {
  attempts: 60,
  intervalMs: 2000
} as const;
