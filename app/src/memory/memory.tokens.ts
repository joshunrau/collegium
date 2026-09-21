import { createServiceToken } from '@collegium/core/utils';

import type { DateFormatter } from '@/formatting/dates/date.formatter.ts';

import type { MemoryService } from './memory.service.ts';

/** the memory toolset reaches the shared date formatter through this token, so the declaration stays inert (§2) */
export const MEMORY_DATE_FORMATTER_TOKEN = createServiceToken<DateFormatter>('MEMORY_DATE_FORMATTER');

/** the memory toolset reaches the service through this token, so the declaration stays inert (§2) */
export const MEMORY_SERVICE_TOKEN = createServiceToken<MemoryService>('MEMORY_SERVICE');
