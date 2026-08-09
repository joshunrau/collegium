import { Module } from '@nestjs/common';

import { ApprovalsModule } from './approvals/approvals.module.ts';
import { CommandsModule } from './commands/commands.module.ts';
import { ConfigModule } from './config/config.module.ts';
import { FormattingModule } from './formatting/formatting.module.ts';
import { HealthModule } from './health/health.module.ts';
import { LoggingModule } from './logging/logging.module.ts';
import { MemoryModule } from './memory/memory.module.ts';
import { PluginsModule } from './plugins/plugins.module.ts';
import { PrismaModule } from './prisma/prisma.module.ts';
import { RuntimeModule } from './runtime/runtime.module.ts';
import { SkillsModule } from './skills/skills.module.ts';
import { ToolsModule } from './tools/tools.module.ts';
import { TriggersModule } from './triggers/triggers.module.ts';

@Module({
  imports: [
    ApprovalsModule,
    CommandsModule,
    ConfigModule,
    FormattingModule,
    HealthModule,
    LoggingModule,
    MemoryModule,
    PluginsModule,
    PrismaModule.forRoot(),
    RuntimeModule,
    SkillsModule,
    ToolsModule,
    TriggersModule
  ]
})
export class AppModule {}
