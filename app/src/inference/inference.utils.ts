import { estimateTokens } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import type { ReasoningDetail } from '@/core/core.types.ts';

import { toCompletionBody } from './adapters/openai-compatible.utils.ts';

import type {
  CompletionMessage,
  CompletionReasoning,
  CompletionRequest,
  CompletionUsage,
  InferenceFailure,
  SystemPrompt
} from './inference.types.ts';

function addReportedAmount(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

/** what one message adds to a request, by the same ruler the window is measured with (§3.8) */
export function estimateMessageTokens(message: CompletionMessage): number {
  return estimateTokens(JSON.stringify(message));
}

/** the whole request as the provider receives it — system prompt, tool definitions and messages — by the same ruler (§3.8) */
export function estimateRequestTokens(request: CompletionRequest): number {
  return estimateTokens(JSON.stringify(toCompletionBody(request)));
}

export function renderSystemPrompt(prompt: SystemPrompt): string {
  return [prompt.stable, prompt.dynamic].filter((part) => part !== '').join('\n\n');
}

/** the reasoning a completion carried, as the keys present and nothing else, so it spreads into an event or a message */
export function reasoningOf(source: {
  readonly reasoningContent?: string | undefined;
  readonly reasoningDetails?: readonly ReasoningDetail[] | undefined;
}): CompletionReasoning {
  return {
    ...(source.reasoningContent !== undefined && { reasoningContent: source.reasoningContent }),
    ...(source.reasoningDetails !== undefined && { reasoningDetails: source.reasoningDetails })
  };
}

/** the one phrase per reason a post may carry: fixed strings, never the runtime's or the provider's words (§3.2) */
export function describeTransportReason(failure: InferenceFailure.Transport): string | undefined {
  return match(failure)
    .with({ reason: 'connect_timeout' }, () => 'connecting timed out')
    .with({ reason: 'dns' }, () => 'the provider’s address could not be resolved')
    .with({ reason: 'http_status' }, ({ status }) => `the provider answered HTTP ${status ?? 'error'}`)
    .with({ reason: 'interrupted' }, () => 'the provider interrupted the completion before it finished')
    .with({ reason: 'refused' }, () => 'the connection was refused')
    .with({ reason: 'reset' }, () => 'the connection was closed before a response arrived')
    .with(
      { reason: 'response_timeout' },
      () => 'the provider accepted the request but sent nothing within the inference timeout'
    )
    .with({ reason: 'tls' }, () => 'the TLS handshake failed')
    .with({ reason: 'unknown' }, () => undefined)
    .exhaustive();
}

/** for the logs, never for a post: the runtime's and the provider's own words are not deterministic output (§3.2) */
export function describeInferenceFailure(failure: InferenceFailure): string {
  return match(failure)
    .with({ kind: 'malformed' }, ({ message }) => `the completion was malformed: ${message}`)
    .with({ kind: 'provider' }, ({ message }) => `the provider rejected the request: ${message}`)
    .with({ kind: 'transport' }, (transport) => {
      const reason = describeTransportReason(transport);
      const detail = transport.detail === undefined ? '' : ` [${transport.detail}]`;
      return `the provider could not be reached${reason === undefined ? '' : `: ${reason}`}${detail}`;
    })
    .exhaustive();
}

export function addCompletionUsage(
  accumulated: CompletionUsage | undefined,
  reported: CompletionUsage
): CompletionUsage {
  if (!accumulated) {
    return reported;
  }
  return {
    cachedPromptTokens: addReportedAmount(accumulated.cachedPromptTokens, reported.cachedPromptTokens),
    completionTokens: accumulated.completionTokens + reported.completionTokens,
    costUsd: addReportedAmount(accumulated.costUsd, reported.costUsd),
    promptTokens: accumulated.promptTokens + reported.promptTokens,
    reasoningTokens: addReportedAmount(accumulated.reasoningTokens, reported.reasoningTokens)
  };
}
