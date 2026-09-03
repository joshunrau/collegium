import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FETCH_BODY_CAP_BYTES, MAX_REDIRECTS } from '../../web.constants.ts';
import { FetchClient } from '../fetch.client.ts';

const html = (body: string, status = 200) => {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' }, status });
};

const redirect = (location: string) => new Response(null, { headers: { location }, status: 302 });

describe('FetchClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let client: FetchClient;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    client = new FetchClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should hand back an HTML body with its status and the URL it was read from', async () => {
    fetchMock.mockResolvedValueOnce(html('<h1>Faculty</h1>', 404));
    const result = await client.get('https://northmoor.example/people/');
    expect(result.value).toStrictEqual({
      body: '<h1>Faculty</h1>',
      kind: 'html',
      status: 404,
      url: 'https://northmoor.example/people/'
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('should follow a redirect and report the address it landed on', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/people/'));
    fetchMock.mockResolvedValueOnce(new Response('a,b', { headers: { 'content-type': 'text/csv' } }));
    const result = await client.get('https://northmoor.example/');
    expect(result.value).toMatchObject({ body: 'a,b', kind: 'text', url: 'https://northmoor.example/people/' });
  });

  it('should refuse a redirect onto a private host before following it', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({
      kind: 'url-refused',
      reason: 'not-public-host',
      url: 'http://169.254.169.254/latest/meta-data/'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should give up on a chain longer than the redirect ceiling', async () => {
    fetchMock.mockResolvedValue(redirect('https://northmoor.example/again'));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toMatchObject({ kind: 'navigation', message: expect.stringContaining(`${MAX_REDIRECTS}`) });
  });

  it('should treat a 3xx without a location as the page it is', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<p>moved</p>', { status: 302 }));
    const result = await client.get('https://northmoor.example/');
    expect(result.value).toMatchObject({ body: '<p>moved</p>', status: 302 });
  });

  it('should refuse a body that is not text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }));
    const result = await client.get('https://northmoor.example/handbook.pdf');
    expect(result.error).toStrictEqual({
      contentType: 'application/pdf',
      kind: 'unsupported-content',
      url: 'https://northmoor.example/handbook.pdf'
    });
  });

  it('should report a network failure as the page not loading', async () => {
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const result = await client.get('https://nope.northmoor.example/');
    expect(result.error).toStrictEqual({ kind: 'navigation', message: 'getaddrinfo ENOTFOUND' });
  });

  it('should decode the body in the charset the server declared', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0xe9]), { headers: { 'content-type': 'text/plain; charset=iso-8859-1' } })
    );
    expect((await client.get('https://northmoor.example/')).value?.body).toBe('é');
  });

  it('should read an empty body as an empty string', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await client.get('https://northmoor.example/')).value?.body).toBe('');
  });

  it('should cut a body past the byte cap and say so', async () => {
    const chunk = new Uint8Array(FETCH_BODY_CAP_BYTES / 2).fill(0x78);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      }
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'text/plain' } }));
    const body = (await client.get('https://northmoor.example/log')).value?.body;
    expect(body?.length).toBe(FETCH_BODY_CAP_BYTES + `\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes`.length);
    expect(body?.endsWith(`…body truncated at ${FETCH_BODY_CAP_BYTES} bytes`)).toBe(true);
  });

  it('should report a body stream that breaks mid-read as the page not loading', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      }
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'text/plain' } }));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({ kind: 'navigation', message: 'connection reset' });
  });
});
