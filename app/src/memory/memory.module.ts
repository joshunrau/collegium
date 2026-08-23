import { Module } from '@nestjs/common';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { MemoryService } from './memory.service.ts';
import { MEMORY_SERVICE_TOKEN } from './memory.tokens.ts';

@Module({
  exports: [MemoryService, MEMORY_SERVICE_TOKEN],
  providers: [MemoryLockService, MemoryService, { provide: MEMORY_SERVICE_TOKEN, useExisting: MemoryService }]
})
export class MemoryModule {}
