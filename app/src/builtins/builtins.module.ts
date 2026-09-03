import { Module } from '@nestjs/common';

import { CLOCK_SERVICE_TOKEN } from './builtins.tokens.ts';
import { ClockService } from './clock/clock.service.ts';

@Module({
  exports: [CLOCK_SERVICE_TOKEN],
  providers: [ClockService, { provide: CLOCK_SERVICE_TOKEN, useExisting: ClockService }]
})
export class BuiltinsModule {}
