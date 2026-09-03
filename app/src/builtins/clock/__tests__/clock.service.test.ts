import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { ClockService } from '../clock.service.ts';

const INSTANT = new Date('2026-09-03T18:22:10Z');

describe('ClockService', () => {
  const createClock = async (timezone?: string): Promise<ClockService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClockService,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone } }) }
      ]
    }).compile();
    return moduleRef.get(ClockService);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render an instant with its weekday and its ISO form in the configured timezone', async () => {
    const clock = await createClock('America/Toronto');
    expect(clock.render(INSTANT)).toBe('Thursday, September 3, 2026 at 2:22:10 PM EDT (2026-09-03T14:22:10-04:00)');
  });

  it('should fall back to the shipped default timezone', async () => {
    const clock = await createClock();
    expect(clock.render(INSTANT)).toBe('Thursday, September 3, 2026 at 6:22:10 PM UTC (2026-09-03T18:22:10+00:00)');
  });

  it('should read the present instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INSTANT);
    const clock = await createClock();
    expect(clock.now()).toBe(clock.render(INSTANT));
  });
});
