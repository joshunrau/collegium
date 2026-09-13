import type { $WebSearchSettings } from '@collegium/core/toolsets';
import type { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import { BraveSearchClient } from './brave.client.ts';

import type { SearchFailure, SearchRequest, SearchResult } from './search.types.ts';

/** routes a search to the provider the agent's web settings name; a new provider is a client and a branch */
@Injectable()
export class SearchService {
  constructor(private readonly braveSearchClient: BraveSearchClient) {}

  search(
    provider: $WebSearchSettings['provider'],
    request: SearchRequest
  ): Promise<Result<SearchResult[], SearchFailure>> {
    return match(provider)
      .with({ kind: 'brave' }, ({ apiKey }) => this.braveSearchClient.search(apiKey, request))
      .exhaustive();
  }
}
