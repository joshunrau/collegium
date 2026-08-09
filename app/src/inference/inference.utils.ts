import { match } from 'ts-pattern';

import type { InferenceFailure } from './inference.types.ts';

/** for the logs, never for a post: the provider's own words are not deterministic output (§3.2) */
export function describeInferenceFailure(failure: InferenceFailure): string {
  return match(failure)
    .with({ kind: 'malformed' }, ({ message }) => `the completion was malformed: ${message}`)
    .with({ kind: 'provider' }, ({ message }) => `the provider rejected the request: ${message}`)
    .with(
      { kind: 'transport' },
      ({ status }) => `the provider could not be reached${status === undefined ? '' : ` (status ${status})`}`
    )
    .exhaustive();
}
