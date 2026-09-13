import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BraveSearchClient } from '../brave.client.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

describe('BraveSearchClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let client: BraveSearchClient;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    client = new BraveSearchClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send the query with the subscription token and map web results', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        web: {
          results: [
            { age: '1 day ago', description: 'Faculty list', title: 'People', url: 'https://northmoor.example/' }
          ]
        }
      })
    );
    const result = await client.search('test-key', { count: 5, query: 'northmoor faculty' });
    expect(result.value).toStrictEqual([
      { age: '1 day ago', description: 'Faculty list', title: 'People', url: 'https://northmoor.example/' }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.search.brave.com/res/v1/web/search?count=5&q=northmoor+faculty&result_filter=web&text_decorations=false',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-subscription-token': 'test-key' }) })
    );
  });

  it('should answer no results when the body carries no web section', async () => {
    fetchMock.mockResolvedValueOnce(json({ query: { original: 'zzqx' } }));
    const result = await client.search('test-key', { count: 5, query: 'zzqx' });
    expect(result.value).toStrictEqual([]);
  });

  it('should report refused credentials as auth', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { detail: 'The provided subscription token is invalid.' } }, 401));
    const result = await client.search('bad-key', { count: 5, query: 'anything' });
    expect(result.error).toStrictEqual({
      kind: 'auth',
      message: 'Brave Search answered HTTP 401: The provided subscription token is invalid.'
    });
  });

  it('should report throttling as rate-limited', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: {} }, 429));
    const result = await client.search('test-key', { count: 5, query: 'anything' });
    expect(result.error).toStrictEqual({ kind: 'rate-limited' });
  });

  it('should report a body outside the contract as unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json({ web: { results: [{ title: 42 }] } }));
    const result = await client.search('test-key', { count: 5, query: 'anything' });
    expect(result.error).toMatchObject({ kind: 'unavailable' });
  });
});
