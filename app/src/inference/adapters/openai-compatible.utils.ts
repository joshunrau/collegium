import type { ToolSchema } from '@/core/core.types.ts';

import type { CompletionMessage, CompletionRequest, ToolCall } from '../inference.types.ts';

function toWireMessage(message: CompletionMessage) {
  switch (message.role) {
    case 'assistant': {
      const reasoning = message.reasoningContent === undefined ? {} : { reasoning_content: message.reasoningContent };
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
  return {
    messages: [{ content: request.systemPrompt, role: 'system' }, ...request.messages.map(toWireMessage)],
    model: request.modelName,
    stream: false,
    ...(request.tools.length > 0 && { tools: request.tools.map(toWireTool) })
  };
}
