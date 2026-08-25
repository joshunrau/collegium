import { createServiceToken } from '@collegium/core/utils';

import type { TriggersService } from './triggers.service.ts';

/** the triggers toolset reaches the service through this token, so the declaration stays inert (§2) */
export const TRIGGERS_SERVICE_TOKEN = createServiceToken<TriggersService>('TRIGGERS_SERVICE');
