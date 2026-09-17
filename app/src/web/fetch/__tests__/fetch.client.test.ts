import { Readable } from 'node:stream';

import { Result } from '@collegium/core/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FETCH_BODY_CAP_BYTES, MAX_REDIRECTS } from '../../web.constants.ts';
import { resolveAndVetHost } from '../../web.policy.ts';
import { FetchClient } from '../fetch.client.ts';
import { pinnedGet } from '../pinned-request.utils.ts';

import type { PinnedResponse } from '../fetch.types.ts';

vi.mock('../../web.policy.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web.policy.ts')>()),
  resolveAndVetHost: vi.fn()
}));

vi.mock('../pinned-request.utils.ts', () => ({ pinnedGet: vi.fn() }));

const resolveMock = vi.mocked(resolveAndVetHost);
const pinnedGetMock = vi.mocked(pinnedGet);

const respond = (body: Readable | string, init: { headers?: { [name: string]: string }; status?: number } = {}) => {
  return {
    body: typeof body === 'string' ? Readable.from([Buffer.from(body)]) : body,
    headers: new Headers(init.headers),
    status: init.status ?? 200
  } satisfies PinnedResponse;
};

const html = (body: string, status = 200) =>
  respond(body, { headers: { 'content-type': 'text/html; charset=utf-8' }, status });

const redirect = (location: string) => respond('', { headers: { location }, status: 302 });

describe('FetchClient', () => {
  let client: FetchClient;

  beforeEach(() => {
    resolveMock.mockReset();
    resolveMock.mockResolvedValue(Result.ok({ address: '203.0.113.7', family: 4 }));
    pinnedGetMock.mockReset();
    client = new FetchClient();
  });

  it('should hand back an HTML body with its status and the URL it was read from', async () => {
    pinnedGetMock.mockResolvedValueOnce(html('<h1>Faculty</h1>', 404));
    const result = await client.get('https://northmoor.example/people/');
    expect(result.value).toStrictEqual({
      body: '<h1>Faculty</h1>',
      kind: 'html',
      status: 404,
      url: 'https://northmoor.example/people/'
    });
  });

  it('should connect to the address the name was vetted at (§3.4)', async () => {
    pinnedGetMock.mockResolvedValueOnce(html('<p>hi</p>'));
    await client.get('https://northmoor.example/');
    expect(pinnedGetMock).toHaveBeenCalledWith(
      'https://northmoor.example/',
      { address: '203.0.113.7', family: 4 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('should follow a redirect, vetting the hop, and report the address it landed on', async () => {
    pinnedGetMock.mockResolvedValueOnce(redirect('/people/'));
    pinnedGetMock.mockResolvedValueOnce(respond('a,b', { headers: { 'content-type': 'text/csv' } }));
    const result = await client.get('https://northmoor.example/');
    expect(result.value).toMatchObject({ body: 'a,b', kind: 'text', url: 'https://northmoor.example/people/' });
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('should refuse a redirect onto a private host before following it', async () => {
    pinnedGetMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({
      kind: 'url-refused',
      reason: 'not-public-host',
      url: 'http://169.254.169.254/latest/meta-data/'
    });
    expect(pinnedGetMock).toHaveBeenCalledTimes(1);
  });

  it('should refuse a redirect onto a name that resolves privately, at that hop (§3.4)', async () => {
    pinnedGetMock.mockResolvedValueOnce(redirect('https://intranet.northmoor.example/'));
    resolveMock.mockResolvedValueOnce(Result.ok({ address: '203.0.113.7', family: 4 }));
    resolveMock.mockResolvedValueOnce(
      Result.err({ kind: 'url-refused', reason: 'not-public-host', url: 'https://intranet.northmoor.example/' })
    );
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toMatchObject({ kind: 'url-refused', url: 'https://intranet.northmoor.example/' });
    expect(pinnedGetMock).toHaveBeenCalledTimes(1);
  });

  it('should give up on a chain longer than the redirect ceiling', async () => {
    pinnedGetMock.mockImplementation(() => Promise.resolve(redirect('https://northmoor.example/again')));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toMatchObject({ kind: 'navigation', message: expect.stringContaining(`${MAX_REDIRECTS}`) });
  });

  it('should treat a 3xx without a location as the page it is', async () => {
    pinnedGetMock.mockResolvedValueOnce(respond('<p>moved</p>', { status: 302 }));
    const result = await client.get('https://northmoor.example/');
    expect(result.value).toMatchObject({ body: '<p>moved</p>', status: 302 });
  });

  it('should refuse a body that is not text', async () => {
    pinnedGetMock.mockResolvedValueOnce(respond('%PDF', { headers: { 'content-type': 'application/pdf' } }));
    const result = await client.get('https://northmoor.example/handbook.pdf');
    expect(result.error).toStrictEqual({
      contentType: 'application/pdf',
      kind: 'unsupported-content',
      url: 'https://northmoor.example/handbook.pdf'
    });
  });

  it('should report a network failure as the page not loading', async () => {
    pinnedGetMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 203.0.113.7:443'));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({ kind: 'navigation', message: 'connect ECONNREFUSED 203.0.113.7:443' });
  });

  it('should decode the body in the charset the server declared', async () => {
    pinnedGetMock.mockResolvedValueOnce(
      respond(Readable.from([Buffer.from([0xe9])]), { headers: { 'content-type': 'text/plain; charset=iso-8859-1' } })
    );
    expect((await client.get('https://northmoor.example/')).value?.body).toBe('é');
  });

  it('should read an empty body as an empty string', async () => {
    pinnedGetMock.mockResolvedValueOnce(respond(Readable.from([]), { status: 204 }));
    expect((await client.get('https://northmoor.example/')).value?.body).toBe('');
  });

  it('should cut a body past the byte cap and say so', async () => {
    const chunk = Buffer.alloc(FETCH_BODY_CAP_BYTES / 2, 0x78);
    const endless = new Readable({
      read() {
        this.push(chunk);
      }
    });
    pinnedGetMock.mockResolvedValueOnce(respond(endless, { headers: { 'content-type': 'text/plain' } }));
    const body = (await client.get('https://northmoor.example/log')).value?.body;
    expect(body?.length).toBe(FETCH_BODY_CAP_BYTES + `\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes`.length);
    expect(body?.endsWith(`…body truncated at ${FETCH_BODY_CAP_BYTES} bytes`)).toBe(true);
    expect(endless.destroyed).toBe(true);
  });

  it('should report a body stream that breaks mid-read as the page not loading', async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error('connection reset'));
      }
    });
    pinnedGetMock.mockResolvedValueOnce(respond(broken, { headers: { 'content-type': 'text/plain' } }));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({ kind: 'navigation', message: 'connection reset' });
  });
});
