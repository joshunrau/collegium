import { Result } from '@collegium/core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InferenceClient } from '../../inference.client.ts';
import { TransportRetrier } from '../transport.retrier.ts';

import type { CompletionRequest, CompletionResult, InferenceFailure } from '../../inference.types.ts';

const completionRequest: CompletionRequest = {
  cacheKey: 'mira:channel-1',
  messages: [{ content: 'Hello', role: 'user' }],
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  systemPrompt: { dynamic: '', memories: '', stable: 'Be helpful' },
  tools: []
};

const completion = Result.ok<CompletionResult>({ content: 'Hello there', kind: 'text', usage: undefined });
const failure = (error: InferenceFailure): Result<CompletionResult, InferenceFailure> => Result.err(error);

describe('TransportRetrier', () => {
  const attemptTimes: number[] = [];
  const complete = vi.fn<InferenceClient['complete']>();

  const inner: InferenceClient = {
    complete: (request, options) => {
      attemptTimes.push(Date.now());
      return complete(request, options);
    }
  };
  const retrier = new TransportRetrier(inner, { backoffMs: 100, maxAttempts: 3 });

  const completeWithTimers = async (): Promise<Result<CompletionResult, InferenceFailure>> => {
    const result = retrier.complete(completionRequest);
    await vi.runAllTimersAsync();
    return result;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    attemptTimes.length = 0;
    complete.mockResolvedValue(failure({ kind: 'transport', reason: 'http_status', status: 503 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('retries a transport failure with exponential backoff up to the attempt cap', async () => {
    const result = await completeWithTimers();

    expect(attemptTimes).toStrictEqual([0, 100, 300]);
    expect(result.error).toStrictEqual({ kind: 'transport', reason: 'http_status', status: 503 });
  });

  it('stops retrying once an attempt succeeds', async () => {
    complete.mockResolvedValueOnce(failure({ kind: 'transport', reason: 'unknown' })).mockResolvedValueOnce(completion);

    await expect(completeWithTimers()).resolves.toStrictEqual(completion);
    expect(attemptTimes).toStrictEqual([0, 100]);
  });

  it('honours a provider-supplied retry delay', async () => {
    complete.mockResolvedValueOnce(failure({ kind: 'transport', reason: 'http_status', retryAfterMs: 5000 }));

    await completeWithTimers();

    expect(attemptTimes.at(1)).toBe(5000);
  });

  it('does not retry a provider failure', async () => {
    complete.mockResolvedValue(failure({ kind: 'provider', message: 'unknown model', status: 400 }));

    await completeWithTimers();

    expect(attemptTimes).toStrictEqual([0]);
  });

  it('does not retry once the turn behind the request has been killed', async () => {
    const controller = new AbortController();
    complete.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(failure({ kind: 'transport', reason: 'response_timeout' }));
    });

    const result = retrier.complete(completionRequest, { signal: controller.signal });
    await vi.runAllTimersAsync();

    expect((await result).error).toStrictEqual({ kind: 'transport', reason: 'response_timeout' });
    expect(attemptTimes).toStrictEqual([0]);
  });

  it('retries a malformed completion as transport (§7.2)', async () => {
    complete
      .mockResolvedValueOnce(failure({ kind: 'malformed', message: 'completion returned empty content' }))
      .mockResolvedValueOnce(completion);

    await expect(completeWithTimers()).resolves.toStrictEqual(completion);
    expect(attemptTimes).toStrictEqual([0, 100]);
  });
});
