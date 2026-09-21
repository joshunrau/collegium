import * as http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { text } from 'node:stream/consumers';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pinnedGet } from '../pinned-request.utils.ts';

describe('pinnedGet', () => {
  let port: number;
  let received: IncomingHttpHeaders[];
  let server: http.Server;

  beforeAll(async () => {
    received = [];
    server = http.createServer((request, response) => {
      received.push(request.headers);
      if (request.url === '/gzipped') {
        response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
        response.end(gzipSync('compressed anyway'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('plain');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server did not bind to a port');
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const get = (path: string, signal = AbortSignal.timeout(5_000)) => {
    return pinnedGet(
      `http://pinned.invalid:${port}${path}`,
      { address: '127.0.0.1', family: 4 },
      {
        accept: 'text/plain',
        signal,
        userAgent: 'Collegium (+https://github.com/joshunrau/collegium)'
      }
    );
  };

  it('should connect to the pinned address while addressing the request to the URL’s own host (§3.4)', async () => {
    const response = await get('/plain');
    expect(await text(response.body)).toBe('plain');
    expect(received.at(-1)?.host).toBe(`pinned.invalid:${port}`);
    expect(received.at(-1)?.['accept-encoding']).toBeUndefined();
  });

  it('should name itself in a user-agent, since robot-policy hosts refuse an unnamed client', async () => {
    await get('/plain');
    expect(received.at(-1)?.['user-agent']).toBe('Collegium (+https://github.com/joshunrau/collegium)');
  });

  it('should decode a body the server compressed anyway and drop the encoding header', async () => {
    const response = await get('/gzipped');
    expect(await text(response.body)).toBe('compressed anyway');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-type')).toBe('text/plain');
  });

  it('should reject once its signal aborts', async () => {
    await expect(get('/plain', AbortSignal.abort(new Error('gave up')))).rejects.toThrow();
  });
});
