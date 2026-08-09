import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { HealthController } from '../health.controller.ts';
import { HealthService } from '../health.service.ts';

import type { HealthReport } from '../health.types.ts';

describe('HealthController', () => {
  let healthController: HealthController;
  let healthService: MockedInstance<HealthService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [MockFactory.createForService(HealthService)]
    }).compile();
    healthController = moduleRef.get(HealthController);
    healthService = moduleRef.get(HealthService);
  });

  describe('getHealth', () => {
    it('should call HealthService.getHealth and passthrough the return value', () => {
      const healthReport = { status: 'ok' } satisfies HealthReport;
      healthService.getHealth.mockReturnValueOnce(healthReport);
      expect(healthController.getHealth()).toBe(healthReport);
      expect(healthService.getHealth).toHaveBeenCalledOnce();
    });
  });
});
