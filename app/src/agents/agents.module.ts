import { Module } from '@nestjs/common';

import { PluginsModule } from '@/plugins/plugins.module.ts';
import { ResourcesModule } from '@/resources/resources.module.ts';

import { AgentRegistry } from './agents.registry.ts';
import { AGENT_REGISTRY_TOKEN } from './agents.tokens.ts';

@Module({
  exports: [AgentRegistry, AGENT_REGISTRY_TOKEN],
  imports: [PluginsModule, ResourcesModule],
  providers: [AgentRegistry, { provide: AGENT_REGISTRY_TOKEN, useExisting: AgentRegistry }]
})
export class AgentsModule {}
