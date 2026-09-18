import type { $ModelRef } from '@collegium/config';

import type { ProviderName, ReasoningDetail, ToolSchema } from '@/core/core.types.ts';

/** what a provider reports having spent; every field beyond the two totals is absent where the provider does not report it */
export type CompletionUsage = {
  readonly cachedPromptTokens: number | undefined;
  readonly completionTokens: number;
  /** money, not tokens: what the provider says it charged, in USD */
  readonly costUsd: number | undefined;
  readonly promptTokens: number;
  readonly reasoningTokens: number | undefined;
};

/** one invocation requested by the model, its arguments JSON-decoded but not yet validated (§3.4) */
export type ToolCall = {
  readonly arguments: unknown;
  readonly id: string;
  readonly name: string;
};

/**
 * Reasoning travels with the assistant message it produced, in memory within the turn and through
 * the `assistant_message` event across turns, because a thinking-mode provider rejects a replayed
 * assistant message without it. DeepSeek hands it back as text; OpenRouter as structured blocks
 * carrying a signature, replayed exactly as they came. §3.12 keeps it off every other surface:
 * never a post, a prompt, a trace, or a log line.
 */
export type CompletionReasoning = {
  reasoningContent?: string;
  reasoningDetails?: readonly ReasoningDetail[];
};

export type CompletionMessage =
  | (CompletionReasoning & { content: string; role: 'assistant'; toolCalls?: readonly ToolCall[] })
  | { content: string; role: 'tool'; toolCallId: string }
  | { content: string; role: 'user' };

export type SystemPrompt = {
  readonly dynamic: string;
  readonly stable: string;
};

export type CompletionRequest = {
  readonly cacheKey: string;
  readonly messages: readonly CompletionMessage[];
  readonly model: $ModelRef;
  readonly systemPrompt: SystemPrompt;
  readonly tools: readonly ToolSchema[];
};

/** the turn's kill, so a request whose turn is gone stops streaming rather than running to its end (§7.5) */
export type CompletionOptions = {
  readonly signal?: AbortSignal;
};

export declare namespace CompletionResult {
  /** no tool call — this is the turn's final output and terminates the turn (§3.3) */
  type Text = CompletionReasoning & {
    content: string;
    kind: 'text';
    usage: CompletionUsage | undefined;
  };
  /** text alongside tool calls is transient status, not output (§3.3) */
  type ToolUse = CompletionReasoning & {
    content: string;
    kind: 'tool-use';
    toolCalls: readonly ToolCall[];
    usage: CompletionUsage | undefined;
  };
  /**
   * Cut at the provider's output limit: not output, since the model never finished, and not a
   * failure, since a shorter attempt is cheap — the turn feeds it back as a rejected post (§4.5)
   */
  type Truncated = CompletionReasoning & {
    content: string;
    kind: 'truncated';
    usage: CompletionUsage | undefined;
  };
  type Any = Text | ToolUse | Truncated;
}

export type CompletionResult = CompletionResult.Any;

/** why the provider was not reached: coarse and deterministic, so a post may name it (§3.2, §7.1) */
export type TransportReason =
  | 'connect_timeout'
  | 'dns'
  | 'http_status'
  | 'interrupted'
  | 'refused'
  | 'reset'
  | 'response_timeout'
  | 'tls'
  | 'unknown';

export declare namespace InferenceFailure {
  type Transport = {
    /** the runtime's own words about the failure, for the log alone — never rendered into a post */
    detail?: string;
    kind: 'transport';
    reason: TransportReason;
    retryAfterMs?: number;
    status?: number;
  };
  type Provider = {
    kind: 'provider';
    message: string;
    status?: number;
  };
  type Malformed = {
    kind: 'malformed';
    message: string;
  };
  /** the provider refused the request for its length: the turn built a prompt its model cannot hold (§7.1) */
  type ContextOverflow = {
    kind: 'context-overflow';
    status?: number;
  };
  type Any = ContextOverflow | Malformed | Provider | Transport;
}

export type InferenceFailure = InferenceFailure.Any;

/** what one boot credential probe established; `unverified` is never folded into `verified` (§7.3) */
export type CredentialProbeOutcome =
  | { readonly kind: 'refused'; readonly status: 401 | 403 }
  | { readonly kind: 'unverified'; readonly reason: string }
  | { readonly kind: 'verified' };

/** one (provider, model) pair the provider refused as unauthorized at boot, and the agents it strands */
export type ProviderCredentialFailure = {
  readonly agentUsernames: readonly string[];
  readonly model: string;
  readonly provider: ProviderName;
  readonly status: 401 | 403;
};
