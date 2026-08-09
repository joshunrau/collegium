import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { MemoryService } from './memory.service.ts';

@Module({
  exports: [MemoryService],
  imports: [AgentsModule],
  providers: [MemoryLockService, MemoryService]
})
export class MemoryModule {}
