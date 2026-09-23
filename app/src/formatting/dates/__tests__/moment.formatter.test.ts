import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { DayFormatter } from '../day.formatter.ts';
import { MomentFormatter } from '../moment.formatter.ts';
import { TimeOfDayFormatter } from '../time-of-day.formatter.ts';

describe('MomentFormatter', () => {
  it('should give the time of day alone on the operator’s today, and name the day before it', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DayFormatter,
        MomentFormatter,
        TimeOfDayFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone: 'America/Toronto' } }) }
      ]
    }).compile();
    const momentFormatter = moduleRef.get(MomentFormatter);
    const now = new Date('2026-09-22T14:00:00Z');
    expect(momentFormatter.format(new Date('2026-09-22T12:30:00Z'), now)).toBe('08:30 EDT');
    expect(momentFormatter.format(new Date('2026-09-22T03:30:00Z'), now)).toBe(
      '23:30 EDT on Monday, September 21, 2026'
    );
  });
});
