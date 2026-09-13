import { match } from 'ts-pattern';

import type { InferenceFailure, TokenUsage } from './inference.types.ts';

function addReportedCount(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

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

export function addTokenUsage(accumulated: TokenUsage | undefined, reported: TokenUsage): TokenUsage {
  if (!accumulated) {
    return reported;
  }
  return {
    cachedPromptTokens: addReportedCount(accumulated.cachedPromptTokens, reported.cachedPromptTokens),
    completionTokens: accumulated.completionTokens + reported.completionTokens,
    promptTokens: accumulated.promptTokens + reported.promptTokens,
    reasoningTokens: addReportedCount(accumulated.reasoningTokens, reported.reasoningTokens)
  };
}
