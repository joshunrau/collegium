import { Controller, Get } from '@nestjs/common';

import { HealthService } from './health.service.ts';

import type { HealthReport } from './health.types.ts';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthReport {
    return this.healthService.getHealth();
  }
}
