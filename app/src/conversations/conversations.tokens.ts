import { createServiceToken } from '@collegium/core/utils';

import type { SearchService } from './search/search.service.ts';

/** the conversations toolset reaches the search through this token, so the declaration stays inert (§2) */
export const SEARCH_SERVICE_TOKEN = createServiceToken<SearchService>('SEARCH_SERVICE');
