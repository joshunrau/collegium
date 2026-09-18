import { describe, expect, it } from 'vitest';

import { TriggerTokenGuard } from '../trigger-token.guard.ts';
import { TriggersController } from '../triggers.controller.ts';

describe('TriggersController', () => {
  it('should stand behind the trigger token guard, so no body is read without it (§6.4)', () => {
    expect(Reflect.getMetadata('__guards__', TriggersController)).toStrictEqual([TriggerTokenGuard]);
  });
});
