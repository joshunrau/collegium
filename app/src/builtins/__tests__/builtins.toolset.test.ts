import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { BUILTINS_TOOLSET } from '../builtins.toolset.ts';
import { ClockService } from '../clock/clock.service.ts';

const { now } = BUILTINS_TOOLSET.tools;

describe('BUILTINS_TOOLSET', () => {
  it('reads the clock', async () => {
    const clock = MockFactory.createMock(ClockService);
    clock.now.mockReturnValue('Thursday, September 3, 2026 at 2:22:10 PM EDT (2026-09-03T14:22:10-04:00)');
    const result = await executeTool(now, {}, { clock, turn: buildToolTurnScope() });
    expect(result.unwrap().text).toBe('Thursday, September 3, 2026 at 2:22:10 PM EDT (2026-09-03T14:22:10-04:00)');
  });

  it('is budget-exempt and retryable (§5.3, §7.2)', () => {
    expect(now.budgetExempt).toBe(true);
    expect(now.retryable).toBe(true);
  });
});
