import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Result } from '../../utils.ts';
import { Tool } from '../tools.definition.ts';

function buildSaveTool() {
  return class extends Tool({
    description: 'Saves a bookmark.',
    name: 'save',
    parameters: z.object({}),
    timeoutMs: 1000,
    variant: 'ungated'
  }) {
    execute(): Tool.Result {
      return Result.ok({ text: 'saved' });
    }

    getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
      return { kind: 'ungated' };
    }

    isRetryable(): boolean {
      return true;
    }

    renderTraceDetail(): string {
      return 'save';
    }
  };
}

describe('Tool', () => {
  it('instances report the configured name', () => {
    const SaveTool = buildSaveTool();
    expect(new SaveTool().name).toBe('save');
    expect(SaveTool.prototype.name).toBe('save');
  });
});
