import { Module } from '@nestjs/common';

import { AgentRegistry } from './agents.registry.ts';

@Module({
  exports: [AgentRegistry],
  providers: [AgentRegistry]
})
export class AgentsModule {}
