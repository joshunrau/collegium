import { createServiceToken } from '@collegium/core/utils';

import type { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';

import type { PostSightingsRegistry } from './sightings/post-sightings.registry.ts';
import type { TasksService } from './tasks.service.ts';

/** the tasks toolset reaches the shared moment formatter through this token, so the declaration stays inert (§2) */
export const TASKS_MOMENT_FORMATTER_TOKEN = createServiceToken<MomentFormatter>('TASKS_MOMENT_FORMATTER');

/** the tasks toolset reaches the service through this token, so the declaration stays inert (§2) */
export const TASKS_SERVICE_TOKEN = createServiceToken<TasksService>('TASKS_SERVICE');

/** the tasks toolset reaches the turn's post sightings through this token, so the declaration stays inert (§2) */
export const TASKS_SIGHTINGS_TOKEN = createServiceToken<PostSightingsRegistry>('TASKS_SIGHTINGS');
