import type { Readable } from 'node:stream';

import { Result } from '@collegium/core/utils';
import { Inject, Injectable } from '@nestjs/common';

import { FETCH_BODY_CAP_BYTES, FETCH_TIMEOUT_MS, FETCH_USER_AGENT, MAX_REDIRECTS } from '../web.constants.ts';
import { ADDRESS_POLICY_TOKEN } from '../web.tokens.ts';
import { charsetOf, classifyContentType, classifyFetchError, describeFetchError, toDecoder } from './fetch.utils.ts';
import { pinnedGet } from './pinned-request.utils.ts';

import type { AddressPolicy, WebFailure } from '../web.types.ts';
import type { FetchedResource, PinnedResponse } from './fetch.types.ts';

const ACCEPT = 'text/html, application/xhtml+xml, text/*;q=0.9, application/json;q=0.8, */*;q=0.1';

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * The plain-HTTP seam: one GET, no session, no script. Redirects are followed by hand so every hop
 * is judged by the same policy as the address the model asked for — this request runs in-process
 * as the orchestrator's OS user, and a redirect onto this machine's network is the classic way to
 * turn a public URL into a private read. Each hop's name is resolved and judged before the
 * connection is made, and the connection is pinned to the address that passed (§3.4).
 */
@Injectable()
export class FetchClient {
  constructor(@Inject(ADDRESS_POLICY_TOKEN) private readonly addressPolicy: AddressPolicy) {}

  async get(
    url: string
  ): Promise<
    Result<FetchedResource, WebFailure.Navigation | WebFailure.Tls | WebFailure.UnsupportedContent | WebFailure.UrlRefused>
  > {
    const followed = await this.follow(url);
    if (!followed.success) {
      return followed;
    }
    const { response, url: finalUrl } = followed.value;
    const contentType = response.headers.get('content-type') ?? '';
    const kind = classifyContentType(contentType);
    if (kind === 'unsupported') {
      response.body.destroy();
      return Result.err({ contentType, kind: 'unsupported-content', url: finalUrl });
    }
    const body = await this.readBody(response.body, charsetOf(contentType));
    if (!body.success) {
      return body;
    }
    return Result.ok({ body: body.value, kind, status: response.status, url: finalUrl });
  }

  private async follow(
    url: string
  ): Promise<
    Result<{ response: PinnedResponse; url: string }, WebFailure.Navigation | WebFailure.Tls | WebFailure.UrlRefused>
  > {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refused = this.addressPolicy.refuse(current);
      if (refused) {
        return Result.err(refused);
      }
      const vetted = await this.addressPolicy.resolve(new URL(current));
      if (!vetted.success) {
        return vetted;
      }
      let response: PinnedResponse;
      try {
        response = await pinnedGet(current, vetted.value, {
          accept: ACCEPT,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          userAgent: FETCH_USER_AGENT
        });
      } catch (error) {
        return Result.err(classifyFetchError(error));
      }
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return Result.ok({ response, url: current });
      }
      response.body.destroy();
      const next = URL.parse(location, current);
      if (next === null) {
        return Result.err({
          kind: 'navigation',
          message: `${current} redirected to "${location}", which is not an address`
        });
      }
      current = next.href;
    }
    return Result.err({ kind: 'navigation', message: `more than ${MAX_REDIRECTS} redirects from ${url}` });
  }

  /** past the cap the stream is destroyed, not drained — the cut is marked so the model knows it holds a part */
  private async readBody(body: Readable, charset: string): Promise<Result<string, WebFailure.Navigation>> {
    const decoder = toDecoder(charset);
    const chunks: string[] = [];
    let received = 0;
    try {
      for await (const chunk of body) {
        const bytes = new Uint8Array(chunk);
        received += bytes.byteLength;
        chunks.push(decoder.decode(bytes, { stream: true }));
        if (received >= FETCH_BODY_CAP_BYTES) {
          body.destroy();
          chunks.push(
            decoder.decode(),
            `\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes; the server was still sending`
          );
          return Result.ok(chunks.join(''));
        }
      }
      chunks.push(decoder.decode());
      return Result.ok(chunks.join(''));
    } catch (error) {
      return Result.err({ kind: 'navigation', message: describeFetchError(error) });
    }
  }
}
