import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { TimeOfDayFormatter } from '../time-of-day.formatter.ts';

describe('TimeOfDayFormatter', () => {
  it('should render the hour and minute on a 24-hour clock in the configured timezone, naming it', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TimeOfDayFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone: 'America/Toronto' } }) }
      ]
    }).compile();
    expect(moduleRef.get(TimeOfDayFormatter).format(new Date('2026-09-22T04:01:14Z'))).toBe('00:01 EDT');
  });
});
