import type { $ModelRef } from '@collegium/config';
import { CHARS_PER_TOKEN, estimateTokens } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import type { ReasoningDetail } from '@/core/core.types.ts';

import { toCompletionBody, toWireMessage } from './adapters/openai-compatible.utils.ts';

import type {
  CompletionMessage,
  CompletionReasoning,
  CompletionRequest,
  CompletionUsage,
  EstimatedCompletionUsage,
  InferenceFailure,
  ProviderCredentialFailure,
  StreamedChars,
  ToolCall,
  UnparsedToolCall
} from './inference.types.ts';

function addReportedAmount(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

/** the smallest completion a provider will price: what boot sends to learn whether it accepts the key for this model (§7.3) */
export function bootProbeRequest(model: $ModelRef): CompletionRequest {
  return {
    cacheKey: 'boot-verification',
    messages: [{ content: 'ping', role: 'user' }],
    model,
    systemPrompt: '',
    tools: []
  };
}

/** §7.1 — a cut-off completion's spend, at the codebase's characters per token, marked as the estimate it is */
export function estimateStreamedUsage(streamed: StreamedChars): EstimatedCompletionUsage {
  return {
    completionTokens: Math.ceil(streamed.completionChars / CHARS_PER_TOKEN),
    estimated: true,
    reasoningTokens: Math.ceil(streamed.reasoningChars / CHARS_PER_TOKEN)
  };
}

/**
 * §3.8 — what one message adds to a request, measured in the form its provider receives, the ruler
 * the request itself is measured by: a provider that takes one of the two reasoning fields a message
 * stores is never charged for both.
 */
export function estimateMessageTokens(message: CompletionMessage, provider: $ModelRef['provider']): number {
  return estimateTokens(JSON.stringify(toWireMessage(message, provider)));
}

/** the whole request as the provider receives it — system prompt, tool definitions and messages — by the same ruler (§3.8) */
export function estimateRequestTokens(request: CompletionRequest): number {
  return estimateTokens(JSON.stringify(toCompletionBody(request)));
}

export function isUnparsedToolCall(call: ToolCall | UnparsedToolCall): call is UnparsedToolCall {
  return 'rawArguments' in call;
}

/** §7.2 — the call as the model may read it again: broken argument text is never read back, so it replays as an empty object */
export function toReplayableToolCall(call: ToolCall | UnparsedToolCall): ToolCall {
  return isUnparsedToolCall(call) ? { arguments: {}, id: call.id, name: call.name } : call;
}

export function describeCredentialRefusal({
  agentUsernames,
  model,
  provider,
  status
}: ProviderCredentialFailure): string {
  const agents = agentUsernames.map((username) => `"${username}"`).join(', ');
  return `${provider} refused "${model}" (HTTP ${status}), used by ${agents}`;
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
    .with({ reason: 'http_status' }, ({ retryAfterMs, status }) => {
      const answer =
        status === 429 ? 'the provider rate-limited the request' : `the provider answered HTTP ${status ?? 'error'}`;
      return retryAfterMs === undefined ? answer : `${answer} and asked to wait ${Math.ceil(retryAfterMs / 1000)}s`;
    })
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
    .with({ kind: 'context-overflow' }, ({ status }) => {
      return `the provider refused the request for its length${status === undefined ? '' : ` (HTTP ${status})`}`;
    })
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
