import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { FETCH_BODY_CAP_BYTES, FETCH_TIMEOUT_MS, MAX_REDIRECTS } from '../web.constants.ts';
import { refuseUnbrowsableUrl } from '../web.policy.ts';
import { charsetOf, classifyContentType, describeFetchError, toDecoder } from './fetch.utils.ts';

import type { WebFailure } from '../web.types.ts';
import type { FetchedResource } from './fetch.types.ts';

const ACCEPT = 'text/html, application/xhtml+xml, text/*;q=0.9, application/json;q=0.8, */*;q=0.1';

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * The plain-HTTP seam: one GET, no session, no script. Redirects are followed by hand so every hop
 * is judged by the same policy as the address the model asked for — this request runs in-process
 * as the orchestrator's OS user, and a redirect onto this machine's network is the classic way to
 * turn a public URL into a private read.
 */
@Injectable()
export class FetchClient {
  async get(
    url: string
  ): Promise<Result<FetchedResource, WebFailure.Navigation | WebFailure.UnsupportedContent | WebFailure.UrlRefused>> {
    const followed = await this.follow(url);
    if (!followed.success) {
      return followed;
    }
    const { response, url: finalUrl } = followed.value;
    const contentType = response.headers.get('content-type') ?? '';
    const kind = classifyContentType(contentType);
    if (kind === 'unsupported') {
      await response.body?.cancel();
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
  ): Promise<Result<{ response: Response; url: string }, WebFailure.Navigation | WebFailure.UrlRefused>> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refused = refuseUnbrowsableUrl(current);
      if (refused) {
        return Result.err(refused);
      }
      let response: Response;
      try {
        response = await fetch(current, {
          headers: { accept: ACCEPT },
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
      } catch (error) {
        return Result.err({ kind: 'navigation', message: describeFetchError(error) });
      }
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return Result.ok({ response, url: current });
      }
      await response.body?.cancel();
      current = new URL(location, current).href;
    }
    return Result.err({ kind: 'navigation', message: `more than ${MAX_REDIRECTS} redirects from ${url}` });
  }

  /** past the cap the stream is cancelled, not drained — the cut is marked so the model knows it holds a part */
  private async readBody(body: Response['body'], charset: string): Promise<Result<string, WebFailure.Navigation>> {
    if (body === null) {
      return Result.ok('');
    }
    const decoder = toDecoder(charset);
    const reader = body.getReader();
    const chunks: string[] = [];
    let received = 0;
    try {
      while (received < FETCH_BODY_CAP_BYTES) {
        const { done, value } = await reader.read();
        if (done) {
          chunks.push(decoder.decode());
          return Result.ok(chunks.join(''));
        }
        received += value.byteLength;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      await reader.cancel();
      chunks.push(decoder.decode(), `\n…body truncated at ${FETCH_BODY_CAP_BYTES} bytes`);
      return Result.ok(chunks.join(''));
    } catch (error) {
      return Result.err({ kind: 'navigation', message: describeFetchError(error) });
    }
  }
}
