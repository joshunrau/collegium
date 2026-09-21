import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { describeFetchError } from '../fetch/fetch.utils.ts';
import { $BraveErrorResponse, $BraveWebSearchResponse } from './brave.schemas.ts';
import { decodeHtmlEntities } from './brave.utils.ts';
import { BRAVE_WEB_SEARCH_ENDPOINT, SEARCH_TIMEOUT_MS } from './search.constants.ts';

import type { SearchFailure, SearchRequest, SearchResult } from './search.types.ts';

/** the Brave Search seam: one web-results query, answered as ranked summaries */
@Injectable()
export class BraveSearchClient {
  async search(apiKey: string, request: SearchRequest): Promise<Result<SearchResult[], SearchFailure>> {
    const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
    url.search = new URLSearchParams({
      count: String(request.count),
      q: request.query,
      result_filter: 'web',
      text_decorations: 'false'
    }).toString();
    let body: unknown;
    try {
      const response = await fetch(url.href, {
        headers: { accept: 'application/json', 'x-subscription-token': apiKey },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        return Result.err(this.toFailure(response.status, await response.json().catch(() => undefined)));
      }
      body = await response.json();
    } catch (error) {
      return Result.err({ kind: 'unavailable', message: `Brave Search did not answer: ${describeFetchError(error)}` });
    }
    const parsed = $BraveWebSearchResponse.safeParse(body);
    if (!parsed.success) {
      return Result.err({ kind: 'unavailable', message: 'Brave Search answered with a body outside its contract' });
    }
    return Result.ok(
      parsed.data.web?.results.map((result) => ({
        ...result,
        description: decodeHtmlEntities(result.description),
        title: decodeHtmlEntities(result.title)
      })) ?? []
    );
  }

  private toFailure(status: number, body: unknown): SearchFailure {
    const detail = $BraveErrorResponse.safeParse(body).data?.error.detail;
    const message = `Brave Search answered HTTP ${status}${detail === undefined ? '' : `: ${detail}`}`;
    if (status === 401 || status === 403) {
      return { kind: 'auth', message };
    }
    if (status === 429) {
      return { kind: 'rate-limited' };
    }
    if (status >= 400 && status < 500) {
      return { kind: 'rejected', message };
    }
    return { kind: 'unavailable', message };
  }
}
