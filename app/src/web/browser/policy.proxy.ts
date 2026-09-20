import * as http from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { pinnedLookup } from '../fetch/pinned-request.utils.ts';
import { ADDRESS_POLICY_TOKEN } from '../web.tokens.ts';

import type { AddressPolicy, VettedAddress } from '../web.types.ts';

const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
  'upgrade'
]);

function endToEndHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name)));
}

/**
 * The one door the browser's traffic leaves through: a loopback HTTP proxy every context is
 * pointed at, so a server redirect, a same-session link click and a page's own sub-resource
 * fetch are each judged here, hop by hop — the browser's own routing hooks never see a redirect,
 * which is why interception alone could not close that gap. Every request resolves and judges
 * its name afresh, and the connection is made to the address that passed, so the browser never
 * resolves a name itself and a record that changes between the check and the connect reaches
 * nothing (§3.4). A refusal closes the connection: the page fails to load, as a dead host would.
 */
@Injectable()
export class PolicyProxy implements OnApplicationShutdown {
  private listening: Promise<string> | undefined;
  private server: http.Server | undefined;
  private readonly tunnels = new Set<Duplex>();

  constructor(@Inject(ADDRESS_POLICY_TOKEN) private readonly policy: Pick<AddressPolicy, 'vet'>) {}

  /** the address a browser context is given; the server starts on first use and lives until shutdown */
  address(): Promise<string> {
    this.listening ??= this.listen();
    return this.listening;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.listening = undefined;
    for (const tunnel of this.tunnels) {
      tunnel.destroy();
    }
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private absoluteUrlOf(target: string | undefined): undefined | URL {
    try {
      return new URL(target ?? '');
    } catch {
      return undefined;
    }
  }

  private connectTunnel(client: Duplex, head: Buffer, vetted: VettedAddress, port: number): void {
    const upstream = net.connect({ family: vetted.family, host: vetted.address, port }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(client);
      client.pipe(upstream);
    });
    this.tunnels.add(client);
    const closeBoth = () => {
      this.tunnels.delete(client);
      client.destroy();
      upstream.destroy();
    };
    upstream.on('error', closeBoth);
    upstream.on('close', closeBoth);
    client.on('error', closeBoth);
    client.on('close', closeBoth);
  }

  /**
   * Only plain http travels in absolute form; https goes through CONNECT. The proxy listens on
   * loopback without authentication, so a request anything local could send must never become an
   * unhandled rejection, which the crash handler would turn into a process exit.
   */
  private async forward(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    try {
      const url = this.absoluteUrlOf(request.url);
      if (url?.protocol !== 'http:') {
        response.writeHead(400).end();
        return;
      }
      const vetted = await this.policy.vet(url);
      if (vetted === undefined) {
        request.socket.destroy();
        return;
      }
      const upstream = http.request(
        url,
        { headers: endToEndHeaders(request.headers), lookup: pinnedLookup(vetted), method: request.method },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, endToEndHeaders(upstreamResponse.headers));
          upstreamResponse.pipe(response);
        }
      );
      upstream.on('error', () => request.socket.destroy());
      request.pipe(upstream);
    } catch {
      request.socket.destroy();
    }
  }

  private listen(): Promise<string> {
    const server = http.createServer((request, response) => void this.forward(request, response));
    server.on('connect', (request, socket, head) => void this.tunnel(request, socket, head));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('the policy proxy did not bind to a port'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  /** CONNECT names only a host and port; the tunnel carries TLS end to end, and the name is what the policy judges */
  private async tunnel(request: http.IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    const url = this.absoluteUrlOf(`https://${request.url ?? ''}`);
    const vetted = url === undefined ? undefined : await this.policy.vet(url);
    if (url === undefined || vetted === undefined) {
      client.destroy();
      return;
    }
    this.connectTunnel(client, head, vetted, url.port === '' ? 443 : Number(url.port));
  }
}
