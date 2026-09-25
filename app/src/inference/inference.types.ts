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
 * A call the provider structured but whose arguments never parsed. Kept apart from `ToolCall`
 * rather than widening `arguments`, so nothing downstream can mistake broken bytes for arguments
 * and every consumer is forced by the type to decide what to do with it (§7.2).
 */
export type UnparsedToolCall = {
  readonly id: string;
  readonly name: string;
  /** exactly what the provider sent, unaltered; never shown to the model */
  readonly rawArguments: string;
};

/**
 * Reasoning travels with the assistant message it produced for the rest of its turn, because a
 * thinking-mode provider rejects continuing from an assistant message without it; the
 * `assistant_message` event keeps it, and a later turn's window hands none of it back (§3.12).
 * DeepSeek hands it back as text; OpenRouter as structured blocks carrying a signature, replayed
 * exactly as they came. §3.12 keeps it off every other surface: never a post, a prompt, a trace,
 * or a log line.
 */
export type CompletionReasoning = {
  reasoningContent?: string;
  reasoningDetails?: readonly ReasoningDetail[];
};

export type CompletionMessage =
  | (CompletionReasoning & { content: string; role: 'assistant'; toolCalls?: readonly ToolCall[] })
  | { content: string; role: 'tool'; toolCallId: string }
  | { content: string; role: 'user' };

export type CompletionRequest = {
  readonly cacheKey: string;
  readonly messages: readonly CompletionMessage[];
  readonly model: $ModelRef;
  /** §3.8 — the one system message, sent first; what changes between turns travels in `messages` after the window */
  readonly systemPrompt: string;
  readonly tools: readonly ToolSchema[];
};

/** the turn's kill, so a request whose turn is gone stops streaming rather than running to its end (§7.5) */
/**
 * §7.1 — what a completion the framework cut off had produced, estimated from its streamed characters,
 * since an aborted stream reports no usage. Kept on its event and out of every total (§8.2).
 */
export type EstimatedCompletionUsage = {
  readonly completionTokens: number;
  readonly estimated: true;
  readonly reasoningTokens: number;
};

/** §7.1 — how much a completion has produced so far, in characters, for the estimate a cut-off stream needs, since it reports no usage */
export type StreamedChars = {
  readonly completionChars: number;
  readonly reasoningChars: number;
};

export type CompletionOptions = {
  /** told what the stream has produced after each chunk, so a caller that cuts it off can say roughly what was spent */
  readonly onStreamed?: (streamed: StreamedChars) => void;
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
    toolCalls: readonly (ToolCall | UnparsedToolCall)[];
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
  /**
   * Text holding a tool call the provider failed to structure — its own call markup, or a bare
   * call object. Not output, since posted it runs nothing, and not a malformed delivery to retry,
   * since the model can make the call properly: the turn feeds it back as a rejected post (§4.5)
   */
  type LeakedCall = CompletionReasoning & {
    content: string;
    kind: 'leaked-call';
    usage: CompletionUsage | undefined;
  };
  type Any = LeakedCall | Text | ToolUse | Truncated;
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
