import type { $ModelRef } from '@/config/config.schemas.ts';
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

export type CompletionMessage =
  | { content: string; role: 'assistant'; toolCalls?: readonly ToolCall[] }
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
    usage: TokenUsage | undefined;
  };
  /** text alongside tool calls is transient status, not output (§3.3) */
  type ToolUse = {
    content: string;
    kind: 'tool-use';
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
