import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { DateLineSection } from '../date-line.section.ts';

describe('DateLineSection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should state the day in the operator’s timezone, naming it, and no time of day (§3.8)', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-22T03:30:00Z'), toFake: ['Date'] });
    const moduleRef = await Test.createTestingModule({
      providers: [
        DateLineSection,
        DayFormatter,
        TextFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone: 'America/Toronto' } }) }
      ]
    }).compile();
    expect(moduleRef.get(DateLineSection).render()).toBe(
      "## Date\n\nToday is Monday, September 21, 2026, in the operator's timezone (America/Toronto)."
    );
  });
});
