import { createServiceToken } from '@collegium/core/utils';

import type { RosterService } from './roster/roster.service.ts';

/** the conversations toolset asks the roster which channels a search may reach through this token (§3.8) */
export const ROSTER_SERVICE_TOKEN = createServiceToken<RosterService>('ROSTER_SERVICE');
