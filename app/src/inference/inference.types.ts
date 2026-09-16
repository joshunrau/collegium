import type { $ModelRef } from '@collegium/config';

import type { ToolSchema } from '@/core/core.types.ts';

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
 * assistant message without it. §3.12 keeps it off every other surface: never a post, a prompt, a
 * trace, or a log line.
 */
export type CompletionMessage =
  | { content: string; reasoningContent?: string; role: 'assistant'; toolCalls?: readonly ToolCall[] }
  | { content: string; role: 'tool'; toolCallId: string }
  | { content: string; role: 'user' };

export type SystemPrompt = {
  readonly dynamic: string;
  readonly stable: string;
};

export type CompletionRequest = {
  readonly cacheKey: string;
  readonly messages: readonly CompletionMessage[];
  readonly modelName: $ModelRef['name'];
  readonly systemPrompt: SystemPrompt;
  readonly tools: readonly ToolSchema[];
};

export declare namespace CompletionResult {
  /** no tool call — this is the turn's final output and terminates the turn (§3.3) */
  type Text = {
    content: string;
    kind: 'text';
    reasoningContent?: string;
    usage: CompletionUsage | undefined;
  };
  /** text alongside tool calls is transient status, not output (§3.3) */
  type ToolUse = {
    content: string;
    kind: 'tool-use';
    reasoningContent?: string;
    toolCalls: readonly ToolCall[];
    usage: CompletionUsage | undefined;
  };
  type Any = Text | ToolUse;
}

export type CompletionResult = CompletionResult.Any;

/** why the provider was not reached: coarse and deterministic, so a post may name it (§3.2, §7.1) */
export type TransportReason =
  'connect_timeout' | 'dns' | 'http_status' | 'refused' | 'reset' | 'response_timeout' | 'tls' | 'unknown';

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
  type Any = Malformed | Provider | Transport;
}

export type InferenceFailure = InferenceFailure.Any;
