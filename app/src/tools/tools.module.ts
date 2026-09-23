import type { WorkUnitLookup } from '@collegium/core/plugins';
import type { ServiceToken } from '@collegium/core/utils';
import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { BuiltinsModule } from '@/builtins/builtins.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { MailModule } from '@/mail/mail.module.ts';
import { MemoryModule } from '@/memory/memory.module.ts';
import { PLUGIN_TOOLSET_SERVICES } from '@/plugins/plugins.constants.ts';
import { PluginsModule } from '@/plugins/plugins.module.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { PLUGIN_WORK_UNIT_LOOKUP_TOKEN } from '@/plugins/plugins.tokens.ts';
import { ShellModule } from '@/shell/shell.module.ts';
import { SkillsModule } from '@/skills/skills.module.ts';
import { TasksModule } from '@/tasks/tasks.module.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { WebModule } from '@/web/web.module.ts';

import { ToolsetStorageService } from './storage/toolset-storage.service.ts';
import { ToolExecutor } from './tools.executor.ts';
import { ToolRegistry } from './tools.registry.ts';
import { FRAMEWORK_TOOLSETS } from './tools.toolsets.ts';
import { registerToolset } from './tools.utils.ts';

/** every service token any framework toolset, or every plugin toolset, declares — the factory's explicit dependencies, so boot order is Nest's problem */
const SERVICE_TOKENS: readonly ServiceToken<unknown>[] = [
  ...FRAMEWORK_TOOLSETS.flatMap((toolset) => Object.values<ServiceToken<unknown>>(toolset.services ?? {})),
  ...Object.values<ServiceToken<unknown>>(PLUGIN_TOOLSET_SERVICES)
];

/** the toolsets' service modules are imported here, where their tokens resolve — never forwarded by the turn */
@Module({
  exports: [ToolExecutor, ToolRegistry],
  imports: [
    AgentsModule,
    ApprovalsModule,
    BuiltinsModule,
    ChannelsModule,
    ConversationsModule,
    MailModule,
    MemoryModule,
    PluginsModule,
    ShellModule,
    SkillsModule,
    TasksModule,
    TriggersModule,
    WebModule
  ],
  providers: [
    ToolExecutor,
    ToolsetStorageService,
    {
      inject: [TasksService],
      provide: PLUGIN_WORK_UNIT_LOOKUP_TOKEN,
      useFactory: (tasksService: TasksService): WorkUnitLookup => tasksService
    },
    {
      inject: [AgentRegistry, PluginsRegistry, ToolsetStorageService, ...SERVICE_TOKENS],
      provide: ToolRegistry,
      useFactory: (
        agentRegistry: AgentRegistry,
        pluginsRegistry: PluginsRegistry,
        storageService: ToolsetStorageService,
        ...services: unknown[]
      ) => {
        const serviceByToken = new Map(SERVICE_TOKENS.map((token, index) => [token, services[index]]));
        const toolsets = [...FRAMEWORK_TOOLSETS, ...pluginsRegistry.toolsets].map((declaration) => {
          return registerToolset(
            declaration,
            (token) => {
              if (!serviceByToken.has(token)) {
                throw new Error(`toolset "${declaration.name}" declares a service token this module does not provide`);
              }
              return serviceByToken.get(token);
            },
            (namespace, collection, schema) => storageService.collection(namespace, collection, schema)
          );
        });
        return new ToolRegistry(toolsets, agentRegistry.list());
      }
    }
  ]
})
export class ToolsModule {}
