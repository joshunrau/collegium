import { Readable } from 'node:stream';

import { Result } from '@collegium/core/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FETCH_BODY_CAP_BYTES, MAX_REDIRECTS } from '../../web.constants.ts';
import { refuseUnbrowsableUrl } from '../../web.policy.ts';
import { FetchClient } from '../fetch.client.ts';
import { pinnedGet } from '../pinned-request.utils.ts';

import type { AddressPolicy } from '../../web.types.ts';
import type { PinnedResponse } from '../fetch.types.ts';

vi.mock('../pinned-request.utils.ts', () => ({ pinnedGet: vi.fn() }));

/** the strict scheme rule, with the resolved half scripted per test */
const policy = {
  refuse: vi.fn(refuseUnbrowsableUrl),
  resolve: vi.fn<AddressPolicy['resolve']>(),
  vet: vi.fn<AddressPolicy['vet']>()
};
const pinnedGetMock = vi.mocked(pinnedGet);

const respond = (body: Readable | string, init: { headers?: { [name: string]: string }; status?: number } = {}) => {
  return {
    body: typeof body === 'string' ? Readable.from([Buffer.from(body)]) : body,
    headers: new Headers(init.headers),
    status: init.status ?? 200
  } satisfies PinnedResponse;
};

const html = (body: string, status = 200) => {
  return respond(body, { headers: { 'content-type': 'text/html; charset=utf-8' }, status });
};

const redirect = (location: string) => respond('', { headers: { location }, status: 302 });

describe('FetchClient', () => {
  let client: FetchClient;

  beforeEach(() => {
    policy.resolve.mockReset();
    policy.resolve.mockResolvedValue(Result.ok({ address: '203.0.113.7', family: 4 }));
    pinnedGetMock.mockReset();
    client = new FetchClient(policy);
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
    expect(policy.resolve).toHaveBeenCalledTimes(2);
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
    policy.resolve.mockResolvedValueOnce(Result.ok({ address: '203.0.113.7', family: 4 }));
    policy.resolve.mockResolvedValueOnce(
      Result.err({ kind: 'url-refused', reason: 'not-public-host', url: 'https://intranet.northmoor.example/' })
    );
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toMatchObject({ kind: 'url-refused', url: 'https://intranet.northmoor.example/' });
    expect(pinnedGetMock).toHaveBeenCalledTimes(1);
  });

  it('should answer a redirect to an address that does not parse as a failed page, not an exception', async () => {
    pinnedGetMock.mockResolvedValueOnce(redirect('http://['));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({
      kind: 'navigation',
      message: 'https://northmoor.example/ redirected to "http://[", which is not an address'
    });
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

  it('should refuse a body that is none of a page, a PDF or text', async () => {
    pinnedGetMock.mockResolvedValueOnce(respond('GIF89a', { headers: { 'content-type': 'image/gif' } }));
    const result = await client.get('https://northmoor.example/crest.gif');
    expect(result.error).toStrictEqual({
      contentType: 'image/gif',
      kind: 'unsupported-content',
      url: 'https://northmoor.example/crest.gif'
    });
  });

  it("should hand back a PDF's bytes as served, undecoded", async () => {
    pinnedGetMock.mockResolvedValueOnce(respond('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } }));
    const result = await client.get('https://northmoor.example/handbook.pdf');
    expect(result.value).toStrictEqual({
      bytes: Buffer.from('%PDF-1.4'),
      isTruncated: false,
      kind: 'pdf',
      status: 200,
      url: 'https://northmoor.example/handbook.pdf'
    });
  });

  it('should report a network failure as the page not loading', async () => {
    pinnedGetMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 203.0.113.7:443'));
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({ kind: 'navigation', message: 'connect ECONNREFUSED 203.0.113.7:443' });
  });

  it('should report a certificate that did not verify as a TLS failure, in its own terms (§3.4)', async () => {
    const unverified = Object.assign(
      new Error(
        'unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'
      ),
      { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }
    );
    pinnedGetMock.mockRejectedValueOnce(unverified);
    const result = await client.get('https://northmoor.example/');
    expect(result.error).toStrictEqual({
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      kind: 'tls',
      reason: 'incomplete-chain'
    });
  });

  it('should decode the body in the charset the server declared', async () => {
    pinnedGetMock.mockResolvedValueOnce(
      respond(Readable.from([Buffer.from([0xe9])]), { headers: { 'content-type': 'text/plain; charset=iso-8859-1' } })
    );
    expect((await client.get('https://northmoor.example/')).value).toMatchObject({ body: 'é' });
  });

  it('should read an empty body as an empty string', async () => {
    pinnedGetMock.mockResolvedValueOnce(respond(Readable.from([]), { status: 204 }));
    expect((await client.get('https://northmoor.example/')).value).toMatchObject({ body: '' });
  });

  it('should cut a body past the byte cap and say so', async () => {
    const chunk = Buffer.alloc(FETCH_BODY_CAP_BYTES / 2, 0x78);
    const endless = new Readable({
      read() {
        this.push(chunk);
      }
    });
    pinnedGetMock.mockResolvedValueOnce(respond(endless, { headers: { 'content-type': 'text/plain' } }));
    const fetched = (await client.get('https://northmoor.example/log')).value;
    const body = fetched?.kind === 'text' ? fetched.body : undefined;
    expect(body?.length).toBe(
      FETCH_BODY_CAP_BYTES + `\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes; the server was still sending`.length
    );
    expect(body?.endsWith(`…body truncated at ${FETCH_BODY_CAP_BYTES} bytes; the server was still sending`)).toBe(true);
    expect(endless.destroyed).toBe(true);
  });

  it('should mark a PDF past the byte cap as truncated rather than cut it silently', async () => {
    const chunk = Buffer.alloc(FETCH_BODY_CAP_BYTES / 2, 0x78);
    const endless = new Readable({
      read() {
        this.push(chunk);
      }
    });
    pinnedGetMock.mockResolvedValueOnce(respond(endless, { headers: { 'content-type': 'application/pdf' } }));
    const result = await client.get('https://northmoor.example/archive.pdf');
    expect(result.value).toMatchObject({ isTruncated: true, kind: 'pdf' });
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
