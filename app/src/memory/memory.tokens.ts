import { createServiceToken } from '@collegium/core/utils';

import type { MemoryService } from './memory.service.ts';

/** the memory toolset reaches the service through this token, so the declaration stays inert (§2) */
export const MEMORY_SERVICE_TOKEN = createServiceToken<MemoryService>('MEMORY_SERVICE');
