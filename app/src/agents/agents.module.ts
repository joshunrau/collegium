import { Module } from '@nestjs/common';

import { PluginsModule } from '@/plugins/plugins.module.ts';

import { AgentRegistry } from './agents.registry.ts';
import { AGENT_REGISTRY_TOKEN } from './agents.tokens.ts';

@Module({
  exports: [AgentRegistry, AGENT_REGISTRY_TOKEN],
  imports: [PluginsModule],
  providers: [AgentRegistry, { provide: AGENT_REGISTRY_TOKEN, useExisting: AgentRegistry }]
})
export class AgentsModule {}
