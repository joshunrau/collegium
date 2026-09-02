import { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { MemoryService } from '../memory.service.ts';
import { MEMORY_TOOLSET } from '../memory.toolset.ts';

const { read, write } = MEMORY_TOOLSET.tools;

function buildContext() {
  const memory = MockFactory.createMock(MemoryService);
  const context = { memory, settings: $MemorySettings.parse({}), turn: buildToolTurnScope() };
  return { context, memory };
}

describe('MEMORY_TOOLSET', () => {
  it('reads a memory body back by reference', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.ok({ body: 'bullet points, always' } as never));
    const result = await executeTool(read, { reference: 'mem-1' }, context);
    expect(memory.read).toHaveBeenCalledWith('mira', 'mem-1');
    expect(result.unwrap().text).toBe('bullet points, always');
  });

  it('returns an unknown reference to the model as its own recoverable mistake', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.err({ kind: 'not-found', reference: 'mem-9' }));
    const result = await executeTool(read, { reference: 'mem-9' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no memory entry with reference "mem-9" exists'
    });
  });

  it('returns an ambiguous reference as a refusal rather than a guess', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.err({ kind: 'ambiguous', reference: 'mem' }));
    const result = await executeTool(read, { reference: 'mem' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'reference "mem" matches more than one memory entry'
    });
  });

  it('writes under the caps its settings declare and returns the disclosure (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.write.mockResolvedValue(
      Result.ok({ entry: { id: 'mem-1-full-id' } as never, evictedDescriptions: ['old fact'], reference: 'mem-1' })
    );
    const result = await executeTool(write, { body: 'the body', description: 'the description' }, context);
    expect(memory.write).toHaveBeenCalledWith(
      { agentUsername: 'mira', body: 'the body', description: 'the description', originPostId: 'post-1' },
      $MemorySettings.parse({})
    );
    expect(result.unwrap()).toStrictEqual({
      disclosure: {
        body: 'the body',
        description: 'the description',
        reference: 'mem-1',
        supersededDescriptions: ['old fact']
      },
      text: 'memory mem-1 saved'
    });
  });

  it('refuses an over-cap write as the model’s recoverable mistake', async () => {
    const { context, memory } = buildContext();
    memory.write.mockResolvedValue(Result.err({ field: 'body', kind: 'too-long', length: 5000, limit: 4000 }));
    const result = await executeTool(write, { body: 'long', description: 'd' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'the body is 5000 characters, over its cap of 4000'
    });
  });

  it('exempts only the read from the action budget (§5.3)', () => {
    expect(read.budgetExempt).toBe(true);
    expect(read.retryable).toBe(true);
    expect(write.budgetExempt).toBeUndefined();
    expect(write.retryable).toBeUndefined();
  });
});
