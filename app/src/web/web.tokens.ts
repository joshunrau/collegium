import { createServiceToken } from '@collegium/core/utils';

import type { WebService } from './web.service.ts';

/** the web toolset reaches the service through this token, so the declaration stays inert (§2) */
export const WEB_SERVICE_TOKEN = createServiceToken<WebService>('WEB_SERVICE');
