import { Injectable } from '@nestjs/common';

import type { HealthReport } from './health.types.ts';

@Injectable()
export class HealthService {
  getHealth(): HealthReport {
    return {
      status: 'ok'
    };
  }
}
