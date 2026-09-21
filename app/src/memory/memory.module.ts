import { Module } from '@nestjs/common';

import { DateFormatter } from '@/formatting/dates/date.formatter.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { MemoryService } from './memory.service.ts';
import { MEMORY_DATE_FORMATTER_TOKEN, MEMORY_SERVICE_TOKEN } from './memory.tokens.ts';

@Module({
  exports: [MemoryService, MEMORY_DATE_FORMATTER_TOKEN, MEMORY_SERVICE_TOKEN],
  providers: [
    MemoryLockService,
    MemoryService,
    { provide: MEMORY_DATE_FORMATTER_TOKEN, useExisting: DateFormatter },
    { provide: MEMORY_SERVICE_TOKEN, useExisting: MemoryService }
  ]
})
export class MemoryModule {}
