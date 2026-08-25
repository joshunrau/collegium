import { createServiceToken } from '@collegium/core/utils';

import type { SkillsService } from './skills.service.ts';

/** the skills toolset reaches the service through this token, so the declaration stays inert (§2) */
export const SKILLS_SERVICE_TOKEN = createServiceToken<SkillsService>('SKILLS_SERVICE');
