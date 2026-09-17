import * as http from 'node:http';
import * as net from 'node:net';
import { text } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PolicyProxy } from '../policy.proxy.ts';

import type { AddressPolicy } from '../../web.types.ts';

/** admits one name, pinned to the loopback server; every other name is refused */
const POLICY: AddressPolicy = {
  vet: (url) => Promise.resolve(url.hostname === 'pinned.invalid' ? { address: '127.0.0.1', family: 4 } : undefined)
};

describe('PolicyProxy', () => {
  let hosts: (string | undefined)[];
  let proxy: PolicyProxy;
  let proxyPort: number;
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    hosts = [];
    server = http.createServer((request, response) => {
      hosts.push(request.headers.host);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('plain');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = (server.address() as net.AddressInfo).port;
    proxy = new PolicyProxy(POLICY);
    proxyPort = Number(new URL(await proxy.address()).port);
  });

  afterAll(async () => {
    await proxy.onApplicationShutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const through = (url: string): Promise<http.IncomingMessage> => {
    return new Promise((resolve, reject) => {
      http
        .request({ headers: { host: new URL(url).host }, host: '127.0.0.1', path: url, port: proxyPort }, resolve)
        .on('error', reject)
        .end();
    });
  };

  const tunnel = (target: string, then: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const socket = net.connect(proxyPort, '127.0.0.1', () => {
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      });
      let received = '';
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString();
        if (received.startsWith('HTTP/1.1 200') && !received.includes('plain')) {
          socket.write(then);
        }
      });
      socket.on('close', () => resolve(received));
      socket.on('error', reject);
    });
  };

  it('should carry a plain request to the vetted address while the server still sees the URL’s host (§3.4)', async () => {
    const response = await through(`http://pinned.invalid:${serverPort}/hello`);
    expect(response.statusCode).toBe(200);
    expect(await text(response)).toBe('plain');
    expect(hosts.at(-1)).toBe(`pinned.invalid:${serverPort}`);
  });

  it('should close the connection on a plain request the policy refuses', async () => {
    await expect(through(`http://refused.invalid:${serverPort}/hello`)).rejects.toThrow();
    expect(hosts).toHaveLength(1);
  });

  it('should tunnel a CONNECT to the vetted address', async () => {
    const received = await tunnel(
      `pinned.invalid:${serverPort}`,
      'GET /hello HTTP/1.1\r\nHost: pinned.invalid\r\nConnection: close\r\n\r\n'
    );
    expect(received).toContain('HTTP/1.1 200 Connection Established');
    expect(received).toContain('plain');
  });

  it('should close a CONNECT the policy refuses without establishing anything', async () => {
    const received = await tunnel(`refused.invalid:${serverPort}`, '');
    expect(received).toBe('');
  });
});
