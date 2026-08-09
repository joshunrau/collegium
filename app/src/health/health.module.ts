import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.ts';
import { HealthService } from './health.service.ts';

@Module({
  controllers: [HealthController],
  providers: [HealthService]
})
export class HealthModule {}
