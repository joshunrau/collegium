import { describe, expect, it } from 'vitest';

import {
  bootProbeRequest,
  describeInferenceFailure,
  estimateRequestTokens,
  isUnparsedToolCall
} from '../inference.utils.ts';

import type { CompletionRequest } from '../inference.types.ts';

describe('bootProbeRequest', () => {
  it('should ask the model for the least a provider will price: one user message, no tools', () => {
    expect(bootProbeRequest({ name: 'deepseek-v4-flash', provider: 'deepseek' })).toEqual({
      cacheKey: 'boot-verification',
      messages: [{ content: 'ping', role: 'user' }],
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      systemPrompt: '',
      tools: []
    });
  });
});

describe('describeInferenceFailure', () => {
  it('should carry the provider’s own words, which are what name a rejected request', () => {
    expect(
      describeInferenceFailure({ kind: 'provider', message: 'deepseek responded with status 400: bad schema' })
    ).toBe('the provider rejected the request: deepseek responded with status 400: bad schema');
  });

  it('should name the reason a transport failure carries, and the runtime’s detail for the log', () => {
    expect(describeInferenceFailure({ kind: 'transport', reason: 'http_status', status: 503 })).toBe(
      'the provider could not be reached: the provider answered HTTP 503'
    );
    expect(
      describeInferenceFailure({ detail: 'TimeoutError: timed out', kind: 'transport', reason: 'response_timeout' })
    ).toBe(
      'the provider could not be reached: the provider accepted the request but sent nothing within the inference timeout [TimeoutError: timed out]'
    );
    expect(
      describeInferenceFailure({ kind: 'transport', reason: 'http_status', retryAfterMs: 60_000, status: 429 })
    ).toBe('the provider could not be reached: the provider rate-limited the request and asked to wait 60s');
    expect(describeInferenceFailure({ kind: 'transport', reason: 'unknown' })).toBe(
      'the provider could not be reached'
    );
  });

  it('should describe a malformed completion', () => {
    expect(describeInferenceFailure({ kind: 'malformed', message: 'completion returned empty content' })).toBe(
      'the completion was malformed: completion returned empty content'
    );
  });
});

describe('estimateRequestTokens', () => {
  const request: CompletionRequest = {
    cacheKey: 'mira:channel-1',
    messages: [{ content: 'hello', role: 'user' }],
    model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
    systemPrompt: 'You are Mira.',
    tools: []
  };

  it('should cost the whole request as sent, so tool definitions and the system prompt weigh in (§3.8)', () => {
    const withTool = { ...request, tools: [{ description: 'Tells the time.', name: 'builtins__now', parameters: {} }] };
    expect(estimateRequestTokens(withTool)).toBeGreaterThan(estimateRequestTokens(request));
    expect(estimateRequestTokens({ ...request, systemPrompt: '' })).toBeLessThan(estimateRequestTokens(request));
  });
});

describe('isUnparsedToolCall', () => {
  it('should tell a call whose arguments never parsed from one whose arguments did', () => {
    expect(isUnparsedToolCall({ id: 'call-1', name: 'read_memory', rawArguments: '{oops' })).toBe(true);
    expect(isUnparsedToolCall({ arguments: {}, id: 'call-1', name: 'read_memory' })).toBe(false);
  });
});
