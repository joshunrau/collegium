import type { $ModelRef } from '@collegium/config';
import { describe, expect, it } from 'vitest';

import { isContextOverflowBody, toCompletionBody } from '../openai-compatible.utils.ts';

import type { CompletionRequest } from '../../inference.types.ts';

const DEEPSEEK_FLASH: $ModelRef = { name: 'deepseek-v4-flash', provider: 'deepseek' };

const CLAUDE_SONNET: $ModelRef = { name: 'anthropic/claude-sonnet-5', provider: 'openrouter' };

const request: CompletionRequest = {
  cacheKey: 'mira:channel-1',
  messages: [{ content: 'Hello', role: 'user' }],
  model: DEEPSEEK_FLASH,
  systemPrompt: { dynamic: 'Current memories and peers', stable: 'Instructions and skills' },
  tools: []
};

const anthropic = (name: 'anthropic/claude-sonnet-5' | '~anthropic/claude-opus-latest'): $ModelRef => ({
  name,
  provider: 'openrouter'
});

const openai = (name: 'openai/gpt-5.6-sol' | 'openai/gpt-6-astra' | '~openai/gpt-luna-latest'): $ModelRef => ({
  name,
  provider: 'openrouter'
});

describe('toCompletionBody', () => {
  it.each([anthropic('anthropic/claude-sonnet-5'), anthropic('~anthropic/claude-opus-latest')])(
    'should cache the stable prefix, system context, and growing history for $name',
    (model) => {
      const body = toCompletionBody({ ...request, model });
      expect(body.cache_control).toStrictEqual({ type: 'ephemeral' });
      expect(body.messages[0]).toStrictEqual({
        content: [
          { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.stable, type: 'text' },
          { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.dynamic, type: 'text' }
        ],
        role: 'system'
      });
      expect(body).not.toHaveProperty('prompt_cache_options');
    }
  );

  it.each([openai('openai/gpt-5.6-sol'), openai('openai/gpt-6-astra'), openai('~openai/gpt-luna-latest')])(
    'should retain automatic caching alongside explicit system boundaries for $name',
    (model) => {
      const body = toCompletionBody({ ...request, model });
      expect(body.prompt_cache_options).toStrictEqual({ mode: 'implicit', ttl: '30m' });
      expect(body.prompt_cache_key).toBe(body.session_id);
      expect(body.messages[0]).toStrictEqual({
        content: [
          { prompt_cache_breakpoint: { mode: 'explicit' }, text: request.systemPrompt.stable, type: 'text' },
          { prompt_cache_breakpoint: { mode: 'explicit' }, text: request.systemPrompt.dynamic, type: 'text' }
        ],
        role: 'system'
      });
      expect(body).not.toHaveProperty('cache_control');
    }
  );

  it.each<$ModelRef>([
    { name: 'deepseek-v4-pro', provider: 'deepseek' },
    { name: 'deepseek/deepseek-v4.1-flash', provider: 'openrouter' },
    { name: '~deepseek/deepseek-pro-latest', provider: 'openrouter' },
    { name: 'z-ai/glm-5.3', provider: 'openrouter' }
  ])('should preserve automatic caching without unsupported controls for $name', (model) => {
    const body = toCompletionBody({ ...request, model });
    expect(body.messages[0]).toStrictEqual({
      content: 'Instructions and skills\n\nCurrent memories and peers',
      role: 'system'
    });
    expect(body).not.toHaveProperty('cache_control');
    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body).not.toHaveProperty('prompt_cache_key');
  });

  it('should keep routing stable across memory changes and window truncation, while separating conversations', () => {
    const routed: CompletionRequest = { ...request, model: { name: 'z-ai/glm-5.3', provider: 'openrouter' } };
    const original = toCompletionBody(routed);
    const changed = toCompletionBody({
      ...routed,
      messages: [{ content: 'A later window', role: 'user' }],
      systemPrompt: { ...request.systemPrompt, dynamic: 'Updated memories' }
    });
    expect(original.session_id).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.session_id).toBe(original.session_id);
    expect(toCompletionBody({ ...routed, cacheKey: 'mira:channel-2' }).session_id).not.toBe(original.session_id);
    expect(toCompletionBody(request)).not.toHaveProperty('session_id');
  });

  it('should preserve the cacheable instruction block when memories change and omit empty blocks', () => {
    const initial = toCompletionBody({
      ...request,
      model: CLAUDE_SONNET,
      systemPrompt: { ...request.systemPrompt, dynamic: '' }
    });
    const updated = toCompletionBody({ ...request, model: CLAUDE_SONNET });
    expect(initial.messages[0]?.content).toStrictEqual([
      { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.stable, type: 'text' }
    ]);
    expect(updated.messages[0]?.content[0]).toStrictEqual(initial.messages[0]?.content[0]);
  });

  it('should stream every completion with usage on the last chunk, asking OpenRouter for its accounting too', () => {
    expect(toCompletionBody(request)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(toCompletionBody(request)).not.toHaveProperty('usage');
    expect(toCompletionBody({ ...request, model: CLAUDE_SONNET })).toMatchObject({ usage: { include: true } });
  });

  it('should state the reasoning effort in each provider’s own form, and nothing where config states none', () => {
    expect(toCompletionBody(request)).not.toHaveProperty('thinking');
    expect(toCompletionBody({ ...request, model: { ...DEEPSEEK_FLASH, reasoningEffort: 'max' } })).toMatchObject({
      thinking: { reasoning_effort: 'max', type: 'enabled' }
    });
    expect(toCompletionBody({ ...request, model: { ...DEEPSEEK_FLASH, reasoningEffort: 'none' } })).toMatchObject({
      thinking: { type: 'disabled' }
    });
    expect(toCompletionBody({ ...request, model: { ...CLAUDE_SONNET, reasoningEffort: 'high' } })).toMatchObject({
      reasoning: { effort: 'high' }
    });
  });

  it('should serialize the same tools identically regardless of registration order', () => {
    const tools = [
      { description: 'Write', name: 'write', parameters: {} },
      { description: 'Read', name: 'read', parameters: {} }
    ];
    expect(toCompletionBody({ ...request, tools }).tools).toStrictEqual(
      toCompletionBody({ ...request, tools: tools.toReversed() }).tools
    );
    expect(tools.map((tool) => tool.name)).toStrictEqual(['write', 'read']);
  });

  it('should omit tool_calls from an assistant message that carries none', () => {
    const body = toCompletionBody({
      ...request,
      messages: [{ content: 'All done', role: 'assistant' }],
      systemPrompt: { dynamic: '', stable: 'Be helpful' }
    });

    expect(body.messages).toStrictEqual([
      { content: 'Be helpful', role: 'system' },
      { content: 'All done', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send a single space as the reasoning of a DeepSeek assistant message that has none or an empty one', () => {
    const body = toCompletionBody({
      ...request,
      messages: [
        { content: 'first', role: 'assistant' },
        { content: 'second', reasoningContent: '', role: 'assistant' }
      ]
    });

    expect(body.messages.slice(1)).toStrictEqual([
      { content: 'first', reasoning_content: ' ', role: 'assistant' },
      { content: 'second', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send an OpenRouter model its reasoning blocks back exactly as they came, and nothing when none were kept', () => {
    const details = [{ format: 'anthropic-claude-v1', index: 0, signature: 'sig', text: 'hm', type: 'reasoning.text' }];
    const body = toCompletionBody({
      ...request,
      messages: [
        { content: 'All done', reasoningContent: 'because', role: 'assistant' },
        { content: 'Later', reasoningDetails: details, role: 'assistant' }
      ],
      model: CLAUDE_SONNET
    });

    expect(body.messages.slice(1)).toStrictEqual([
      { content: 'All done', role: 'assistant' },
      { content: 'Later', reasoning_details: details, role: 'assistant' }
    ]);
  });

  it('should send reasoning content back beside the tool calls it produced', () => {
    const body = toCompletionBody({
      ...request,
      messages: [
        {
          content: '',
          reasoningContent: 'because',
          role: 'assistant',
          toolCalls: [{ arguments: { path: 'a.md' }, id: 'call-1', name: 'write_file' }]
        }
      ]
    });

    expect(body.messages[1]).toStrictEqual({
      content: '',
      reasoning_content: 'because',
      role: 'assistant',
      tool_calls: [{ function: { arguments: '{"path":"a.md"}', name: 'write_file' }, id: 'call-1', type: 'function' }]
    });
  });
});

describe('isContextOverflowBody', () => {
  it('should recognise each provider’s own wording for a length rejection (§7.1)', () => {
    expect(isContextOverflowBody("This model's maximum context length is 65536 tokens")).toBe(true);
    expect(isContextOverflowBody('{"error":{"code":"context_length_exceeded"}}')).toBe(true);
    expect(isContextOverflowBody('prompt is too long: 210000 tokens > 200000 maximum')).toBe(true);
  });

  it('should leave an unrelated rejection alone', () => {
    expect(isContextOverflowBody('invalid api key')).toBe(false);
  });
});
