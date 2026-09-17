import { createServiceToken } from '@collegium/core/utils';

import type { SearchService } from './search/search.service.ts';
import type { WebService } from './web.service.ts';
import type { AddressPolicy } from './web.types.ts';

/** the web toolset reaches the service through this token, so the declaration stays inert (§2) */
export const WEB_SERVICE_TOKEN = createServiceToken<WebService>('WEB_SERVICE');

export const SEARCH_SERVICE_TOKEN = createServiceToken<SearchService>('SEARCH_SERVICE');

/** what the browser's proxy judges every request against — the production policy, unless a test admits its own server */
export const ADDRESS_POLICY_TOKEN = createServiceToken<AddressPolicy>('ADDRESS_POLICY');
