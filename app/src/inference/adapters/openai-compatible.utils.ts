import { DEEPSEEK_MODELS } from '@collegium/core/common';

import type { ToolSchema } from '@/core/core.types.ts';

import type { CompletionMessage, CompletionRequest, ToolCall } from '../inference.types.ts';

/**
 * A DeepSeek thinking model refuses a request whose tail it must continue from — a trailing
 * assistant message, or a tool-call round still awaiting the model — when that message carries no
 * `reasoning_content`; earlier rounds are accepted without it. A trailing assistant message is what
 * a queued turn sees when the agent's own reply landed after the post it drains from, so every
 * assistant message is sent with the field, a single space standing in where none was kept, which
 * the Pro model is reported to require over an empty string. Every other model is sent none, since
 * providers that do not define the field reject it.
 */
const REASONING_ECHO_MODELS: ReadonlySet<string> = new Set(DEEPSEEK_MODELS);

const REASONING_PLACEHOLDER = ' ';

function toWireReasoning(reasoningContent: string | undefined, echoesReasoning: boolean) {
  if (!echoesReasoning) {
    return {};
  }
  const content = reasoningContent === undefined || reasoningContent === '' ? REASONING_PLACEHOLDER : reasoningContent;
  return { reasoning_content: content };
}

function toWireMessage(message: CompletionMessage, echoesReasoning: boolean) {
  switch (message.role) {
    case 'assistant': {
      const reasoning = toWireReasoning(message.reasoningContent, echoesReasoning);
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

/** the request in Chat Completions wire form: system prompt leading, tools omitted when none are offered */
export function toCompletionBody(request: CompletionRequest) {
  const echoesReasoning = REASONING_ECHO_MODELS.has(request.modelName);
  return {
    messages: [
      { content: request.systemPrompt, role: 'system' },
      ...request.messages.map((message) => toWireMessage(message, echoesReasoning))
    ],
    model: request.modelName,
    stream: false,
    ...(request.tools.length > 0 && { tools: request.tools.map(toWireTool) })
  };
}
