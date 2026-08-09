import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthService } from '../health.service.ts';

import type { HealthReport } from '../health.types.ts';

describe('HealthService', () => {
  let healthService: HealthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService]
    }).compile();

    healthService = moduleRef.get(HealthService);
  });

  describe('getHealth', () => {
    it('should report ok with the configured roster', () => {
      expect(healthService.getHealth()).toStrictEqual({
        status: 'ok'
      } satisfies HealthReport);
    });
  });
});
