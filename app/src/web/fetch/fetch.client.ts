import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { Result } from '@collegium/core/utils';
import { Inject, Injectable } from '@nestjs/common';

import { FETCH_BODY_CAP_BYTES, FETCH_TIMEOUT_MS, FETCH_USER_AGENT, MAX_REDIRECTS } from '../web.constants.ts';
import { ADDRESS_POLICY_TOKEN } from '../web.tokens.ts';
import {
  charsetOf,
  classifyContentType,
  classifyFetchError,
  describeFetchError,
  rateLimitRetryWaitMs,
  toDecoder
} from './fetch.utils.ts';
import { pinnedGet } from './pinned-request.utils.ts';

import type { AddressPolicy, RateLimitRetry, VettedAddress, WebFailure } from '../web.types.ts';
import type { FetchedResource, PinnedResponse } from './fetch.types.ts';

const ACCEPT =
  'text/html, application/xhtml+xml, text/*;q=0.9, application/json;q=0.8, application/pdf;q=0.8, */*;q=0.1';

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
    Result<
      FetchedResource,
      WebFailure.Navigation | WebFailure.Tls | WebFailure.UnsupportedContent | WebFailure.UrlRefused
    >
  > {
    const followed = await this.follow(url);
    if (!followed.success) {
      return followed;
    }
    const { response, retry, url: finalUrl } = followed.value;
    const answered = { status: response.status, url: finalUrl, ...(retry && { retry }) };
    const contentType = response.headers.get('content-type') ?? '';
    const kind = classifyContentType(contentType);
    if (kind === 'unsupported') {
      response.body.destroy();
      return Result.err({ contentType, kind: 'unsupported-content', url: finalUrl });
    }
    const read = await this.readBody(response.body);
    if (!read.success) {
      return read;
    }
    const { bytes, isTruncated } = read.value;
    if (kind === 'pdf') {
      return Result.ok({ ...answered, bytes, isTruncated, kind });
    }
    const text = toDecoder(charsetOf(contentType)).decode(bytes);
    const body = isTruncated
      ? `${text}\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes; the server was still sending`
      : text;
    return Result.ok({ ...answered, body, kind });
  }

  private async follow(
    url: string
  ): Promise<
    Result<
      { response: PinnedResponse; retry?: RateLimitRetry; url: string },
      WebFailure.Navigation | WebFailure.Tls | WebFailure.UrlRefused
    >
  > {
    let current = url;
    let retry: RateLimitRetry | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refused = this.addressPolicy.refuse(current);
      if (refused) {
        return Result.err(refused);
      }
      const vetted = await this.addressPolicy.resolve(new URL(current));
      if (!vetted.success) {
        return vetted;
      }
      const requested = await this.request(current, vetted.value, retry === undefined);
      if (!requested.success) {
        return requested;
      }
      const { response } = requested.value;
      retry ??= requested.value.retry;
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return Result.ok({ response, url: current, ...(retry && { retry }) });
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

  /** past the cap the stream is destroyed, not drained — the cut is reported so the model knows it holds a part */
  private async readBody(
    body: Readable
  ): Promise<Result<{ bytes: Uint8Array; isTruncated: boolean }, WebFailure.Navigation>> {
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for await (const chunk of body) {
        const bytes = new Uint8Array(chunk).slice();
        received += bytes.byteLength;
        chunks.push(bytes);
        if (received >= FETCH_BODY_CAP_BYTES) {
          body.destroy();
          return Result.ok({ bytes: Buffer.concat(chunks), isTruncated: true });
        }
      }
      return Result.ok({ bytes: Buffer.concat(chunks), isTruncated: false });
    } catch (error) {
      return Result.err({ kind: 'navigation', message: describeFetchError(error) });
    }
  }

  /**
   * One hop's GET, asked once more when the site answers with a rate limit whose wait fits the
   * hop's own timeout (§3.4). The retry shares that timeout rather than starting its own, so the
   * tool's timeout stays a backstop and never becomes the bound.
   */
  private async request(
    url: string,
    vetted: VettedAddress,
    mayRetry: boolean
  ): Promise<Result<{ response: PinnedResponse; retry?: RateLimitRetry }, WebFailure.Navigation | WebFailure.Tls>> {
    const deadline = Date.now() + FETCH_TIMEOUT_MS;
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const first = await this.send(url, vetted, signal);
    if (!first.success) {
      return first;
    }
    const waitMs = mayRetry ? rateLimitRetryWaitMs(first.value, Date.now(), deadline) : undefined;
    if (waitMs === undefined) {
      return Result.ok({ response: first.value });
    }
    first.value.body.destroy();
    await sleep(waitMs);
    const second = await this.send(url, vetted, signal);
    return second.success
      ? Result.ok({ response: second.value, retry: { status: first.value.status, waitedMs: waitMs } })
      : second;
  }

  private async send(
    url: string,
    vetted: VettedAddress,
    signal: AbortSignal
  ): Promise<Result<PinnedResponse, WebFailure.Navigation | WebFailure.Tls>> {
    try {
      return Result.ok(await pinnedGet(url, vetted, { accept: ACCEPT, signal, userAgent: FETCH_USER_AGENT }));
    } catch (error) {
      return Result.err(classifyFetchError(error));
    }
  }
}
