import { createServiceToken } from '@collegium/core/utils';

import type { ClockService } from './clock/clock.service.ts';

/** the builtins toolset reaches the clock through this token, so the declaration stays inert (§2) */
export const CLOCK_SERVICE_TOKEN = createServiceToken<ClockService>('CLOCK_SERVICE');
