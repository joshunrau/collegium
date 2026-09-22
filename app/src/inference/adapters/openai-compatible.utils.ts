import type { $ModelRef } from '@collegium/config';
import { match } from 'ts-pattern';

import type { ToolSchema } from '@/core/core.types.ts';

import { toPromptCaching } from './prompt-caching.utils.ts';

import type { CompletionMessage, CompletionRequest, ToolCall } from '../inference.types.ts';

type AssistantMessage = Extract<CompletionMessage, { role: 'assistant' }>;

const RETRY_AFTER_SECONDS = /^\d+(?:\.\d+)?$/u;

/**
 * A DeepSeek thinking model refuses a request whose tail it must continue from — a trailing
 * assistant message, or a tool-call round still awaiting the model — when that message carries no
 * `reasoning_content`; earlier rounds are accepted without it. The window never ends on the
 * agent's own message (§5.2), so the tail that matters is this turn's own last round; every
 * assistant message is sent with the field regardless, a single space standing in where none is
 * handed back (an earlier turn's never is, §3.12), which the Pro model is reported to require over
 * an empty string. OpenRouter instead takes back the structured blocks it returned, exactly as
 * returned, and only where any are handed back.
 */
const REASONING_PLACEHOLDER = ' ';

function toWireReasoning(message: AssistantMessage, provider: $ModelRef['provider']) {
  return match(provider)
    .with('deepseek', () => ({
      reasoning_content:
        message.reasoningContent === undefined || message.reasoningContent === ''
          ? REASONING_PLACEHOLDER
          : message.reasoningContent
    }))
    .with('openrouter', () => {
      return message.reasoningDetails === undefined ? {} : { reasoning_details: message.reasoningDetails };
    })
    .exhaustive();
}

function toWireMessage(message: CompletionMessage, provider: $ModelRef['provider']) {
  switch (message.role) {
    case 'assistant': {
      const reasoning = toWireReasoning(message, provider);
      if (!message.toolCalls || message.toolCalls.length === 0) {
        return { content: message.content, role: message.role, ...reasoning };
      }
      return {
        content: message.content,
        role: message.role,
        tool_calls: message.toolCalls.map(toWireToolCall),
        ...reasoning
      };
    }
    case 'tool':
      return { content: message.content, role: message.role, tool_call_id: message.toolCallId };
    case 'user':
      return { content: message.content, role: message.role };
  }
}

/** each provider's own knob for how hard the model thinks; nothing is sent where config states nothing, leaving the provider's default */
function toReasoningOptions(model: $ModelRef) {
  return match(model)
    .with({ provider: 'deepseek' }, ({ reasoningEffort }) => {
      if (reasoningEffort === undefined) {
        return {};
      }
      return {
        thinking:
          reasoningEffort === 'none'
            ? { type: 'disabled' as const }
            : { reasoning_effort: reasoningEffort, type: 'enabled' as const }
      };
    })
    .with({ provider: 'openrouter' }, ({ reasoningEffort }) => {
      return reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } };
    })
    .exhaustive();
}

function toWireTool(tool: ToolSchema) {
  return {
    function: { description: tool.description, name: tool.name, parameters: tool.parameters },
    type: 'function'
  };
}

function toWireToolCall(toolCall: ToolCall) {
  return {
    function: { arguments: JSON.stringify(toolCall.arguments), name: toolCall.name },
    id: toolCall.id,
    type: 'function'
  };
}

/**
 * A rejection for the request's length, told apart from every other 4xx by the provider's own
 * words: each spells it differently and none documents the string, so the markers are a set.
 */
const CONTEXT_OVERFLOW_MARKERS = [
  'context_length_exceeded',
  'context length',
  'maximum context',
  'too many tokens',
  'reduce the length of the messages',
  'prompt is too long'
];

/** the request in Chat Completions wire form: system prompt leading, streamed with usage on the last chunk, tools omitted when none are offered */
export function toCompletionBody(request: CompletionRequest) {
  const { provider } = request.model;
  const caching = toPromptCaching(request);
  return {
    ...caching.options,
    ...toReasoningOptions(request.model),
    messages: [caching.systemMessage, ...request.messages.map((message) => toWireMessage(message, provider))],
    model: request.model.name,
    stream: true,
    stream_options: { include_usage: true },
    ...(provider === 'openrouter' && { usage: { include: true } }),
    ...(request.tools.length > 0 && {
      tools: request.tools
        .toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        .map(toWireTool)
    })
  };
}

export function isContextOverflowBody(body: string): boolean {
  const lowered = body.toLowerCase();
  return CONTEXT_OVERFLOW_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * How long a refusing provider asked to be left alone, in milliseconds: OpenAI's `retry-after-ms`
 * where sent, else `Retry-After` as seconds or as an HTTP date. A header that says neither is no
 * request at all, and the retry policy's own backoff applies.
 */
export function parseRetryAfterMs(headers: Headers, now: number): number | undefined {
  const milliseconds = Number.parseFloat(headers.get('retry-after-ms') ?? '');
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return Math.ceil(milliseconds);
  }
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter === undefined) {
    return undefined;
  }
  if (RETRY_AFTER_SECONDS.test(retryAfter)) {
    return Math.ceil(Number(retryAfter) * 1000);
  }
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
