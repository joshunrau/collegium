import type { $ModelRef } from '@collegium/config';

import type { ToolSchema } from '@/core/core.types.ts';

/** what a provider reports having spent; reasoning content itself is never stored (§3.12) */
export type TokenUsage = {
  readonly completionTokens: number;
  readonly promptTokens: number;
};

/** one invocation requested by the model, its arguments JSON-decoded but not yet validated (§3.4) */
export type ToolCall = {
  readonly arguments: unknown;
  readonly id: string;
  readonly name: string;
};

/**
 * Reasoning rides only on the in-memory messages of the turn that produced it: a thinking-mode
 * provider rejects a replayed tool call without it, and §3.12 forbids it anywhere durable — never
 * copy it into a TurnEvent, a post, or a log line.
 */
export type CompletionMessage =
  | { content: string; reasoningContent?: string; role: 'assistant'; toolCalls?: readonly ToolCall[] }
  | { content: string; role: 'tool'; toolCallId: string }
  | { content: string; role: 'user' };

export type CompletionRequest = {
  readonly messages: readonly CompletionMessage[];
  readonly modelName: $ModelRef['name'];
  readonly systemPrompt: string;
  readonly tools: readonly ToolSchema[];
};

export declare namespace CompletionResult {
  /** no tool call — this is the turn's final output and terminates the turn (§3.3) */
  type Text = {
    content: string;
    kind: 'text';
    reasoningContent?: string;
    usage: TokenUsage | undefined;
  };
  /** text alongside tool calls is transient status, not output (§3.3) */
  type ToolUse = {
    content: string;
    kind: 'tool-use';
    reasoningContent?: string;
    toolCalls: readonly ToolCall[];
    usage: TokenUsage | undefined;
  };
  type Any = Text | ToolUse;
}

export type CompletionResult = CompletionResult.Any;

export declare namespace InferenceFailure {
  type Transport = {
    kind: 'transport';
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
