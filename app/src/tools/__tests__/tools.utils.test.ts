import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toToolSchema } from '../tools.utils.ts';

const fixture = <TParams extends z.ZodType>(parameters: TParams) => {
  class FixtureTool extends Tool({
    description: 'a fixture',
    name: 'fixture',
    parameters,
    timeoutMs: 1000,
    variant: 'ungated'
  }) {
    execute(): Promise<Tool.Result> {
      return Promise.resolve(Result.ok({ text: 'done' }));
    }

    getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
      return { kind: 'ungated' };
    }

    isRetryable(): true {
      return true;
    }

    renderTraceDetail(): string {
      return '';
    }
  }
  return new FixtureTool();
};

describe('toToolSchema', () => {
  it('should root a union at an object, which is the only shape providers accept', () => {
    const { parameters } = toToolSchema(
      fixture(
        z.discriminatedUnion('action', [
          z.object({ action: z.enum(['navigate']), url: z.url() }),
          z.object({ action: z.enum(['click']), ref: z.string() })
        ])
      )
    );
    expect(parameters.type).toBe('object');
    expect(parameters.oneOf).toBeUndefined();
    expect(parameters.anyOf).toHaveLength(2);
  });

  it('should keep each variant’s own required list, so the schema still states what an action needs', () => {
    const { parameters } = toToolSchema(
      fixture(
        z.discriminatedUnion('action', [
          z.object({ action: z.enum(['navigate']), url: z.url() }),
          z.object({ action: z.enum(['click']), ref: z.string() })
        ])
      )
    );
    expect(parameters.anyOf).toContainEqual(expect.objectContaining({ required: ['action', 'url'] }));
  });

  it('should leave a schema that is already an object untouched', () => {
    const { parameters } = toToolSchema(fixture(z.object({ command: z.string() })));
    expect(parameters).toStrictEqual(z.toJSONSchema(z.object({ command: z.string() })));
  });
});
