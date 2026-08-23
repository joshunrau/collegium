import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { PluginsModule } from '@/plugins/plugins.module.ts';

import { SkillsService } from './skills.service.ts';
import { SKILLS_SERVICE_TOKEN } from './skills.tokens.ts';

@Module({
  exports: [SkillsService, SKILLS_SERVICE_TOKEN],
  imports: [AgentsModule, PluginsModule],
  providers: [SkillsService, { provide: SKILLS_SERVICE_TOKEN, useExisting: SkillsService }]
})
export class SkillsModule {}
