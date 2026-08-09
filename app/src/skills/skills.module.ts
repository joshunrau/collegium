import { Module } from '@nestjs/common';

import { PluginsModule } from '@/plugins/plugins.module.ts';

import { SkillsService } from './skills.service.ts';

@Module({
  exports: [SkillsService],
  imports: [PluginsModule],
  providers: [SkillsService]
})
export class SkillsModule {}
