import type { Promisable } from 'type-fest';

const DEFAULT_INTERVAL_MS = 200;

export type Pending = typeof PENDING;

export const PENDING: unique symbol = Symbol('pending');

/** a probe throws this to end the wait NOW — the condition can never become true, retrying is waste */
export class ProbeAbortError extends Error {}

export type WaitForOptions<T> = {
  describeFailure?: () => Promisable<string>;
  description: string;
  intervalMs?: number;
  probe: () => Promisable<Pending | T>;
  timeoutMs: number;
};

export async function waitFor<T>({
  describeFailure,
  description,
  intervalMs = DEFAULT_INTERVAL_MS,
  probe,
  timeoutMs
}: WaitForOptions<T>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastRejection: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== PENDING) {
        return result;
      }
      lastRejection = undefined;
    } catch (error) {
      if (error instanceof ProbeAbortError) {
        throw error;
      }
      // a probe is a live REST call; one transient refusal must not fail the test before the deadline
      lastRejection = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const observed = await describeFailure?.();
  throw new Error(
    [
      `timed out after ${timeoutMs}ms waiting for ${description}`,
      lastRejection instanceof Error && `last probe rejection: ${lastRejection.message}`,
      observed && `observed:\n${observed}`
    ]
      .filter(Boolean)
      .join('\n')
  );
}
