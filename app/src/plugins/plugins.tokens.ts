import type { WorkUnitLookup } from '@collegium/core/plugins';
import { createServiceToken } from '@collegium/core/utils';

/** §3.14 — what every plugin toolset reads work units through; bound where the toolsets' services resolve */
export const PLUGIN_WORK_UNIT_LOOKUP_TOKEN = createServiceToken<WorkUnitLookup>('PLUGIN_WORK_UNIT_LOOKUP');
