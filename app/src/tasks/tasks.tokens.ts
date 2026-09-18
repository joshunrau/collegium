import { createServiceToken } from '@collegium/core/utils';

import type { TasksService } from './tasks.service.ts';

/** the tasks toolset reaches the service through this token, so the declaration stays inert (§2) */
export const TASKS_SERVICE_TOKEN = createServiceToken<TasksService>('TASKS_SERVICE');
