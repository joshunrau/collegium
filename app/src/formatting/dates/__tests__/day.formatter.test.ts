import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { DayFormatter } from '../day.formatter.ts';

describe('DayFormatter', () => {
  it('should render the weekday and date an instant falls on in the configured timezone', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DayFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone: 'America/Toronto' } }) }
      ]
    }).compile();
    expect(moduleRef.get(DayFormatter).format(new Date('2026-09-22T03:30:00Z'))).toBe('Monday, September 21, 2026');
  });
});
