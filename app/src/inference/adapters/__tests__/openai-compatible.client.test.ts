import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleClient } from '../openai-compatible.client.ts';

import type { CompletionRequest, InferenceFailure } from '../../inference.types.ts';

const completionRequest: CompletionRequest = {
  messages: [{ content: 'Hello', role: 'user' }],
  modelName: 'deepseek-v4-flash',
  systemPrompt: 'Be helpful',
  tools: []
};

const completionResponse = (message: unknown, usage?: unknown): Response =>
  Response.json({ choices: [{ message }], ...(usage !== undefined && { usage }) });

describe('OpenAICompatibleClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new OpenAICompatibleClient(
    {
      apiKey: 'key',
      baseUrl: 'https://example.com',
      timeoutMs: 15_000
    },
    'provider'
  );

  const expectFailure = async (expected: InferenceFailure): Promise<void> => {
    const result = await client.complete(completionRequest);
    expect(result.success).toBe(false);
    expect(result.error).toStrictEqual(expected);
  };

  const sentBody = (): unknown => {
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    return JSON.parse(body as string);
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns text from a completion carrying no tool calls', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'Hello there' }));

    const result = await client.complete(completionRequest);

    expect(result.value).toStrictEqual({ content: 'Hello there', kind: 'text', usage: undefined });
  });

  it('carries provider-reported token usage', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({ content: 'Hello there' }, { completion_tokens: 3, prompt_tokens: 12, total_tokens: 15 })
    );

    const result = await client.complete(completionRequest);

    expect(result.value?.usage).toStrictEqual({ completionTokens: 3, promptTokens: 12 });
  });

  it('returns tool calls with decoded arguments, absent text becoming empty transient status', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({
        content: null,
        tool_calls: [
          { function: { arguments: '{"id":"memory-1"}', name: 'read_memory' }, id: 'call-1', type: 'function' }
        ]
      })
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toStrictEqual({
      content: '',
      kind: 'tool-use',
      toolCalls: [{ arguments: { id: 'memory-1' }, id: 'call-1', name: 'read_memory' }],
      usage: undefined
    });
  });

  it('carries several tool calls from one completion in order', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({
        content: 'Working on it',
        tool_calls: [
          { function: { arguments: '{}', name: 'load_skill' }, id: 'call-1', type: 'function' },
          { function: { arguments: '{}', name: 'read_memory' }, id: 'call-2', type: 'function' }
        ]
      })
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({
      content: 'Working on it',
      kind: 'tool-use',
      toolCalls: [{ id: 'call-1' }, { id: 'call-2' }]
    });
  });

  it('classifies a tool call whose arguments are not valid JSON as malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({
        content: null,
        tool_calls: [{ function: { arguments: '{oops', name: 'read_memory' }, id: 'call-1', type: 'function' }]
      })
    );

    await expectFailure({ kind: 'malformed', message: 'completion response was malformed' });
  });

  it('sends the wire form: system prompt first, tool calls and results round-tripped, tools declared', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'ok' }));

    await client.complete({
      messages: [
        { content: 'Load the skill', role: 'user' },
        {
          content: 'Loading',
          role: 'assistant',
          toolCalls: [{ arguments: { name: 'triage' }, id: 'call-1', name: 'load_skill' }]
        },
        { content: 'the document', role: 'tool', toolCallId: 'call-1' }
      ],
      modelName: 'deepseek-v4-flash',
      systemPrompt: 'Be helpful',
      tools: [{ description: 'Load a skill', name: 'load_skill', parameters: { type: 'object' } }]
    });

    expect(sentBody()).toStrictEqual({
      messages: [
        { content: 'Be helpful', role: 'system' },
        { content: 'Load the skill', role: 'user' },
        {
          content: 'Loading',
          role: 'assistant',
          tool_calls: [
            { function: { arguments: '{"name":"triage"}', name: 'load_skill' }, id: 'call-1', type: 'function' }
          ]
        },
        { content: 'the document', role: 'tool', tool_call_id: 'call-1' }
      ],
      model: 'deepseek-v4-flash',
      stream: false,
      tools: [
        {
          function: { description: 'Load a skill', name: 'load_skill', parameters: { type: 'object' } },
          type: 'function'
        }
      ]
    });
  });

  it('omits the tools field when the agent is offered none', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'ok' }));

    await client.complete(completionRequest);

    expect(sentBody()).not.toHaveProperty('tools');
  });

  it('classifies a timeout as a transport failure', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));

    await expectFailure({ kind: 'transport' });
  });

  it('aborts a completion that outlives its timeout, classifying it as a transport failure', async () => {
    const impatientClient = new OpenAICompatibleClient(
      { apiKey: 'key', baseUrl: 'https://example.com', timeoutMs: 5 },
      'provider'
    );
    fetchMock.mockImplementationOnce((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    });

    const result = await impatientClient.complete(completionRequest);

    expect(result.success).toBe(false);
    expect(result.error).toStrictEqual({ kind: 'transport' });
  });

  it('classifies a body that fails mid-read as a transport failure', async () => {
    const response = Response.json({});
    vi.spyOn(response, 'json').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    fetchMock.mockResolvedValueOnce(response);

    await expectFailure({ kind: 'transport' });
  });

  it('classifies a server error as a transport failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

    await expectFailure({ kind: 'transport', status: 503 });
  });

  it('classifies a rate limit as a transport failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));

    await expectFailure({ kind: 'transport', status: 429 });
  });

  it('classifies another client error as a provider failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unknown model', { status: 400 }));

    await expectFailure({
      kind: 'provider',
      message: 'provider responded with status 400: unknown model',
      status: 400
    });
  });

  it('reports a provider failure without a body when the error body cannot be read', async () => {
    const response = new Response('unknown model', { status: 400 });
    vi.spyOn(response, 'text').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    fetchMock.mockResolvedValueOnce(response);

    await expectFailure({ kind: 'provider', message: 'provider responded with status 400', status: 400 });
  });

  it('classifies an invalid response body as malformed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{', { status: 200 }));

    await expectFailure({ kind: 'malformed', message: 'completion response was malformed' });
  });

  it('classifies empty content with no tool calls as malformed', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: '  ' }));

    await expectFailure({ kind: 'malformed', message: 'completion returned empty content' });
  });
});
