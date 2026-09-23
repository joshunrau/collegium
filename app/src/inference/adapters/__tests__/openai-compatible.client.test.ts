import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleClient } from '../openai-compatible.client.ts';

import type { CompletionRequest, InferenceFailure } from '../../inference.types.ts';

const completionRequest: CompletionRequest = {
  cacheKey: 'mira:channel-1',
  messages: [{ content: 'Hello', role: 'user' }],
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  systemPrompt: 'Be helpful',
  tools: []
};

type WireToolCall = { function: { arguments: string; name: string }; id: string; index: number };

type WireMessage = { content?: null | string; reasoning_content?: string; tool_calls?: WireToolCall[] };

const streamed = (chunks: unknown[], { done = true }: { done?: boolean } = {}): Response => {
  const events = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  return new Response([...events, ...(done ? ['data: [DONE]\n\n'] : [])].join(''), {
    headers: { 'content-type': 'text/event-stream' },
    status: 200
  });
};

const completionResponse = (message: WireMessage, usage?: unknown, finishReason = 'stop'): Response => {
  return streamed([
    { choices: [{ delta: message, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: finishReason }] },
    ...(usage === undefined ? [] : [{ choices: [], usage }])
  ]);
};

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

  it('joins the text a stream delivers in pieces, keep-alive comments between them', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        [
          ': OPENROUTER PROCESSING\n\n',
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] })}\n\n`,
          'data: [DONE]\n\n'
        ].join(''),
        { status: 200 }
      )
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({ content: 'Hello there', kind: 'text' });
  });

  it('carries reasoning content a thinking-mode provider returns, and omits it when absent', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'Hello', reasoning_content: 'because' }));

    const result = await client.complete(completionRequest);

    expect(result.value).toStrictEqual({
      content: 'Hello',
      kind: 'text',
      reasoningContent: 'because',
      usage: undefined
    });
  });

  it('keeps an empty reasoning string, since the request must still echo the field', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'Hello', reasoning_content: '' }));

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({ reasoningContent: '' });
  });

  it('carries the structured reasoning blocks OpenRouter returns, joined across chunks', async () => {
    fetchMock.mockResolvedValueOnce(
      streamed([
        { choices: [{ delta: { reasoning_details: [{ index: 0, text: 'let me ', type: 'reasoning.text' }] } }] },
        { choices: [{ delta: { content: 'Hi', reasoning_details: [{ index: 0, signature: 's', text: 'see' }] } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({
      content: 'Hi',
      reasoningDetails: [{ index: 0, signature: 's', text: 'let me see', type: 'reasoning.text' }]
    });
  });

  it('carries provider-reported token usage from the last chunk', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({ content: 'Hello there' }, { completion_tokens: 3, prompt_tokens: 12, total_tokens: 15 })
    );

    const result = await client.complete(completionRequest);

    expect(result.value?.usage).toStrictEqual({
      cachedPromptTokens: undefined,
      completionTokens: 3,
      costUsd: undefined,
      promptTokens: 12,
      reasoningTokens: undefined
    });
  });

  it('carries the cached-prompt, reasoning, and cost breakdowns where the provider reports them', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(
        { content: 'Hello there' },
        {
          completion_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 21 },
          cost: 0.0132,
          prompt_tokens: 120,
          prompt_tokens_details: { cached_tokens: 96 }
        }
      )
    );

    const result = await client.complete(completionRequest);

    expect(result.value?.usage).toStrictEqual({
      cachedPromptTokens: 96,
      completionTokens: 30,
      costUsd: 0.0132,
      promptTokens: 120,
      reasoningTokens: 21
    });
  });

  it('returns tool calls with decoded arguments, absent text becoming empty transient status', async () => {
    fetchMock.mockResolvedValueOnce(
      streamed([
        {
          choices: [
            {
              delta: {
                content: null,
                tool_calls: [{ function: { arguments: '{"id":', name: 'read_memory' }, id: 'call-1', index: 0 }]
              },
              finish_reason: null
            }
          ]
        },
        { choices: [{ delta: { tool_calls: [{ function: { arguments: '"memory-1"}' }, index: 0 }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
      ])
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
      completionResponse(
        {
          content: 'Working on it',
          tool_calls: [
            { function: { arguments: '{}', name: 'load_skill' }, id: 'call-1', index: 0 },
            { function: { arguments: '{}', name: 'read_memory' }, id: 'call-2', index: 1 }
          ]
        },
        undefined,
        'tool_calls'
      )
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({
      content: 'Working on it',
      kind: 'tool-use',
      toolCalls: [{ id: 'call-1' }, { id: 'call-2' }]
    });
  });

  it('surfaces a call whose arguments are not valid JSON as an unparsed call carrying the raw text (§7.2)', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(
        {
          content: null,
          tool_calls: [{ function: { arguments: '{oops', name: 'read_memory' }, id: 'call-1', index: 0 }]
        },
        undefined,
        'tool_calls'
      )
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({
      kind: 'tool-use',
      toolCalls: [{ id: 'call-1', name: 'read_memory', rawArguments: '{oops' }]
    });
  });

  it('keeps the other calls of a completion usable when one is unparsed', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(
        {
          content: null,
          tool_calls: [
            { function: { arguments: '{oops', name: 'read_memory' }, id: 'call-1', index: 0 },
            { function: { arguments: '{"name":"triage"}', name: 'load_skill' }, id: 'call-2', index: 1 }
          ]
        },
        undefined,
        'tool_calls'
      )
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toMatchObject({
      toolCalls: [{ rawArguments: '{oops' }, { arguments: { name: 'triage' }, id: 'call-2' }]
    });
  });

  it('still classifies a tool call with no id or no name as a malformed completion', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(
        {
          content: null,
          tool_calls: [{ function: { arguments: '{}', name: 'read_memory' }, id: '', index: 0 }]
        },
        undefined,
        'tool_calls'
      )
    );

    await expectFailure({ kind: 'malformed', message: 'completion response was malformed' });
  });

  it('returns output cut at the length limit as truncated rather than as a reply', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({ content: 'Half a th', reasoning_content: 'hm' }, undefined, 'length')
    );

    const result = await client.complete(completionRequest);

    expect(result.value).toStrictEqual({
      content: 'Half a th',
      kind: 'truncated',
      reasoningContent: 'hm',
      usage: undefined
    });
  });

  it('returns text holding the provider’s own call markup as a leaked call, not a reply (§4.5)', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: '</parameter>\n</invoke></｜DSML｜parameter>' }));

    const result = await client.complete(completionRequest);

    expect(result.value?.kind).toBe('leaked-call');
  });

  it('classifies a filtered completion as a provider failure', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: '' }, undefined, 'content_filter'));

    await expectFailure({ kind: 'provider', message: 'provider filtered the completion' });
  });

  it.each(['insufficient_system_resource', 'aborted'])(
    'classifies a completion the provider interrupted (%s) as a retryable transport failure',
    async (finishReason) => {
      fetchMock.mockResolvedValueOnce(completionResponse({ content: 'partial' }, undefined, finishReason));

      await expectFailure({ detail: `finish_reason ${finishReason}`, kind: 'transport', reason: 'interrupted' });
    }
  );

  it('classifies a stream that ends without a finish reason as a connection lost mid-body', async () => {
    fetchMock.mockResolvedValueOnce(
      streamed([{ choices: [{ delta: { content: 'partial' }, finish_reason: null }] }], { done: false })
    );

    await expectFailure({
      detail: 'the stream ended before the completion finished',
      kind: 'transport',
      reason: 'reset'
    });
  });

  it('classifies an error object in the stream by its code: retryable status as transport, else provider', async () => {
    fetchMock.mockResolvedValueOnce(streamed([{ error: { code: 502, message: 'upstream down' } }]));
    await expectFailure({ kind: 'transport', reason: 'http_status', status: 502 });

    fetchMock.mockResolvedValueOnce(streamed([{ error: { code: 400, message: 'bad schema' } }]));
    await expectFailure({
      kind: 'provider',
      message: 'provider reported an error mid-stream: bad schema',
      status: 400
    });
  });

  it('sends the wire form: system prompt first, tool calls and results round-tripped, tools declared, streamed', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: 'ok' }));

    await client.complete({
      cacheKey: 'mira:channel-1',
      messages: [
        { content: 'Load the skill', role: 'user' },
        {
          content: 'Loading',
          role: 'assistant',
          toolCalls: [{ arguments: { name: 'triage' }, id: 'call-1', name: 'load_skill' }]
        },
        { content: 'the document', role: 'tool', toolCallId: 'call-1' }
      ],
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      systemPrompt: 'Be helpful',
      tools: [{ description: 'Load a skill', name: 'load_skill', parameters: { type: 'object' } }]
    });

    expect(sentBody()).toStrictEqual({
      messages: [
        { content: 'Be helpful', role: 'system' },
        { content: 'Load the skill', role: 'user' },
        {
          content: 'Loading',
          reasoning_content: ' ',
          role: 'assistant',
          tool_calls: [
            { function: { arguments: '{"name":"triage"}', name: 'load_skill' }, id: 'call-1', type: 'function' }
          ]
        },
        { content: 'the document', role: 'tool', tool_call_id: 'call-1' }
      ],
      model: 'deepseek-v4-flash',
      stream: true,
      stream_options: { include_usage: true },
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

  it('classifies a timeout as a transport failure the provider did not respond to', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));

    await expectFailure({ detail: 'AbortError: timed out', kind: 'transport', reason: 'response_timeout' });
  });

  it('names the cause a failed fetch carries: dns, refusal, reset, tls, connect timeout', async () => {
    const failing = (code: string) => {
      return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
    };
    for (const [code, reason] of [
      ['ENOTFOUND', 'dns'],
      ['ECONNREFUSED', 'refused'],
      ['ECONNRESET', 'reset'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
      ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout'],
      ['SOMETHING_ELSE', 'unknown']
    ] as const) {
      fetchMock.mockRejectedValueOnce(failing(code));
      const result = await client.complete(completionRequest);
      expect(result.error).toMatchObject({
        detail: `TypeError: fetch failed (cause: ${code})`,
        kind: 'transport',
        reason
      });
    }
  });

  it('aborts a request the provider never answers, classifying it as a transport failure', async () => {
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
    expect(result.error).toMatchObject({ kind: 'transport', reason: 'response_timeout' });
  });

  it('aborts a stream that goes quiet for the idle timeout, however much arrived before', async () => {
    const impatientClient = new OpenAICompatibleClient(
      { apiKey: 'key', baseUrl: 'https://example.com', timeoutMs: 20 },
      'provider'
    );
    fetchMock.mockImplementationOnce((_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        }
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    const result = await impatientClient.complete(completionRequest);

    expect(result.error).toMatchObject({ kind: 'transport', reason: 'response_timeout' });
  });

  it('aborts the request when the turn is killed', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        controller.abort();
      });
    });

    const result = await client.complete(completionRequest, { signal: controller.signal });

    expect(result.error).toMatchObject({ kind: 'transport', reason: 'response_timeout' });
  });

  it('classifies a server error as a transport failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

    await expectFailure({ kind: 'transport', reason: 'http_status', status: 503 });
  });

  it('classifies a rate limit as a transport failure, carrying the wait it asked for', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { headers: { 'retry-after': '7' }, status: 429 }));

    await expectFailure({ kind: 'transport', reason: 'http_status', retryAfterMs: 7000, status: 429 });
  });

  it('classifies a rejection naming context length as a context overflow, never a provider failure (§7.1)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("This model's maximum context length is 65536 tokens", { status: 400 })
    );

    await expectFailure({ kind: 'context-overflow', status: 400 });
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

  it('classifies an event that is not JSON as malformed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {\n\n', { status: 200 }));

    await expectFailure({ kind: 'malformed', message: 'completion response was malformed' });
  });

  it('classifies empty content with no tool calls as malformed', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ content: '  ' }));

    await expectFailure({ kind: 'malformed', message: 'completion returned empty content' });
  });
});
