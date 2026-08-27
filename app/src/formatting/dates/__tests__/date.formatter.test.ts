import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { DateFormatter } from '../date.formatter.ts';

describe('DateFormatter', () => {
  const createFormatter = async (timezone?: string): Promise<DateFormatter> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DateFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone } }) }
      ]
    }).compile();
    return moduleRef.get(DateFormatter);
  };

  it('should render a date in the configured timezone', async () => {
    const formatter = await createFormatter('America/Toronto');
    expect(formatter.format(new Date('2026-07-26T12:00:00Z'))).toBe('July 26, 2026 at 8:00:00 AM EDT');
  });

  it('should fall back to the shipped default timezone', async () => {
    const formatter = await createFormatter();
    expect(formatter.format(new Date('2026-07-26T12:00:00Z'))).toBe('July 26, 2026 at 12:00:00 PM UTC');
  });
});
