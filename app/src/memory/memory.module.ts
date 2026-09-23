import { Module } from '@nestjs/common';

import { DateFormatter } from '@/formatting/dates/date.formatter.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { MemoryService } from './memory.service.ts';
import { MEMORY_DATE_FORMATTER_TOKEN, MEMORY_SERVICE_TOKEN, MEMORY_SIGHTINGS_TOKEN } from './memory.tokens.ts';
import { MemorySightingsRegistry } from './sightings/memory-sightings.registry.ts';

@Module({
  exports: [
    MemoryService,
    MemorySightingsRegistry,
    MEMORY_DATE_FORMATTER_TOKEN,
    MEMORY_SERVICE_TOKEN,
    MEMORY_SIGHTINGS_TOKEN
  ],
  providers: [
    MemoryLockService,
    MemoryService,
    MemorySightingsRegistry,
    { provide: MEMORY_DATE_FORMATTER_TOKEN, useExisting: DateFormatter },
    { provide: MEMORY_SERVICE_TOKEN, useExisting: MemoryService },
    { provide: MEMORY_SIGHTINGS_TOKEN, useExisting: MemorySightingsRegistry }
  ]
})
export class MemoryModule {}
