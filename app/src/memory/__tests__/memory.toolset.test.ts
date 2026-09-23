import { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { MemoryService } from '../memory.service.ts';
import { MEMORY_TOOLSET } from '../memory.toolset.ts';
import { MemorySightingsRegistry } from '../sightings/memory-sightings.registry.ts';

import type { MemoryRevision } from '../memory.types.ts';

const { append, delete: deleteTool, read, replace, rewrite, write } = MEMORY_TOOLSET.tools;

const STORED = {
  body: 'bullet points, always',
  createdAt: new Date(Date.now() - (3 * 24 + 2) * 3_600_000 - 60_000),
  description: 'a stale fact',
  id: 'mem00001-full-id',
  revisedAt: null,
  revision: 0
} as ModelRow<'Memory'>;

function buildContext() {
  const dateFormatter = MockFactory.createMock(DateFormatter);
  dateFormatter.format.mockReturnValue('September 18, 2026 at 9:04:00 AM EDT');
  const memory = MockFactory.createMock(MemoryService);
  memory.read.mockResolvedValue(Result.ok(STORED));
  const sightings = new MemorySightingsRegistry();
  const context = { dateFormatter, memory, settings: $MemorySettings.parse({}), sightings, turn: buildToolTurnScope() };
  return { context, memory };
}

/** the service's delete, judged against one stored entry as the real one judges under its lock */
function deletingAgainst(stored: ModelRow<'Memory'>) {
  return (_agentUsername: string, _reference: string, admit: (entry: ModelRow<'Memory'>) => Result<void, unknown>) => {
    return Promise.resolve(admit(stored).pipe(() => stored));
  };
}

/** the service's revision, applied to one stored entry as the real one applies it under its lock */
function revisingAgainst(stored: ModelRow<'Memory'>) {
  return (revision: MemoryRevision, reviseBody: (entry: ModelRow<'Memory'>) => Result<string, unknown>) => {
    return Promise.resolve(
      reviseBody(stored).pipe((body) => {
        const description = revision.description ?? stored.description;
        const entry = { ...stored, body, description, revision: stored.revision + 1 };
        return { entry, previous: stored, reference: 'mem00001' };
      })
    );
  };
}

describe('MEMORY_TOOLSET', () => {
  it('reads a memory body back under its age and its written-at date, marking the entry used (§3.6)', async () => {
    const { context, memory } = buildContext();
    const result = await executeTool(read, { reference: 'mem00001' }, context);
    expect(memory.read).toHaveBeenCalledWith('mira', 'mem00001');
    expect(memory.markUsed).toHaveBeenCalledWith('mem00001-full-id');
    expect(result.unwrap().text).toBe(
      'written 3d 2h ago, on September 18, 2026 at 9:04:00 AM EDT\n\nbullet points, always'
    );
  });

  it('adds the age of the last revision to the header of a revised memory (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.ok({ ...STORED, revisedAt: new Date(Date.now() - 5 * 60_000), revision: 2 }));
    const result = await executeTool(read, { reference: 'mem00001' }, context);
    expect(result.unwrap().text).toMatch(/^written 3d 2h ago, on .+; last revised 5m ago\n\n/u);
  });

  it('returns an unknown reference to the model as its own recoverable mistake', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.err({ kind: 'not-found', reference: 'mem-9' }));
    const result = await executeTool(read, { reference: 'mem-9' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'none of your memories has the reference "mem-9"; memories are private to each agent'
    });
    expect(memory.markUsed).not.toHaveBeenCalled();
  });

  it('returns an ambiguous reference as a refusal rather than a guess', async () => {
    const { context, memory } = buildContext();
    memory.read.mockResolvedValue(Result.err({ kind: 'ambiguous', reference: 'mem' }));
    const result = await executeTool(read, { reference: 'mem' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'reference "mem" matches more than one of your memories'
    });
  });

  it('writes under the caps its settings declare and returns the disclosure (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.write.mockResolvedValue(Result.ok({ entry: STORED, evictedDescriptions: ['old fact'], reference: 'mem-1' }));
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
      text: 'memory mem-1 saved (8 of 16,000 characters); at the cap of 50 memories, it removed the one read longest ago: "old fact"'
    });
  });

  it('refuses an over-cap write as the model’s recoverable mistake', async () => {
    const { context, memory } = buildContext();
    memory.write.mockResolvedValue(Result.err({ field: 'body', kind: 'too-long', length: 5000, limit: 4000 }));
    const result = await executeTool(write, { body: 'long', description: 'd' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'the body is 5,000 characters, over its cap of 4,000; shorten it and write again'
    });
  });

  it('deletes a memory the turn read, naming what left (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.deleteAdmitted.mockImplementation(deletingAgainst(STORED));
    await executeTool(read, { reference: 'mem00001' }, context);
    const result = await executeTool(deleteTool, { reference: 'mem00001' }, context);
    expect(result.unwrap()).toStrictEqual({ text: 'memory mem00001 deleted: a stale fact' });
  });

  it('deletes a memory the turn wrote without reading it back (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.write.mockResolvedValue(Result.ok({ entry: STORED, evictedDescriptions: [], reference: 'mem00001' }));
    memory.deleteAdmitted.mockImplementation(deletingAgainst(STORED));
    await executeTool(write, { body: 'b', description: 'd' }, context);
    expect((await executeTool(deleteTool, { reference: 'mem00001' }, context)).success).toBe(true);
  });

  it('refuses to delete a memory the turn has not read (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.deleteAdmitted.mockImplementation(deletingAgainst(STORED));
    const result = await executeTool(deleteTool, { reference: 'mem00001' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'you have not read memory mem00001 in this turn; read it first'
    });
  });

  it('refuses to delete a memory revised since the turn read it (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.deleteAdmitted.mockImplementation(deletingAgainst({ ...STORED, revision: 1 }));
    await executeTool(read, { reference: 'mem00001' }, context);
    const result = await executeTool(deleteTool, { reference: 'mem00001' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'memory mem00001 was revised since you read it; read it again first'
    });
  });

  it('returns an unknown reference on delete as the model’s own recoverable mistake', async () => {
    const { context, memory } = buildContext();
    memory.deleteAdmitted.mockResolvedValue(Result.err({ kind: 'not-found', reference: 'mem-9' }));
    const result = await executeTool(deleteTool, { reference: 'mem-9' }, context);
    expect(result.error).toMatchObject({ kind: 'invalid-arguments', message: expect.stringContaining('none of your') });
  });

  it('revises a memory in place and discloses its count, its size and the passage it replaced (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockImplementation(revisingAgainst({ ...STORED, revision: 2 }));
    const result = await executeTool(
      replace,
      { passage: 'bullet points, always', reference: 'mem00001', replacement: 'numbered lists' },
      context
    );
    expect(result.unwrap()).toStrictEqual({
      disclosure: {
        body: 'numbered lists',
        description: 'a stale fact',
        reference: 'mem00001',
        revision: { count: 3, replacedPassages: ['bullet points, always'] }
      },
      text: 'memory mem00001 revised (14 of 16,000 characters)'
    });
  });

  it('applies several edits in order and discloses each passage and the description it replaced (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockImplementation(revisingAgainst(STORED));
    const edits = [
      { passage: 'bullet points', replacement: 'numbered lists' },
      { passage: 'lists, always', replacement: 'lists, mostly' }
    ];
    const result = await executeTool(replace, { description: 'formatting', edits, reference: 'mem00001' }, context);
    expect(result.unwrap().disclosure).toMatchObject({
      body: 'numbered lists, mostly',
      description: 'formatting',
      revision: {
        count: 1,
        replacedDescription: 'a stale fact',
        replacedPassages: ['bullet points', 'lists, always']
      }
    });
  });

  it('refuses every edit when one does not match, naming it', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockImplementation(revisingAgainst(STORED));
    const edits = [
      { passage: 'bullet', replacement: 'numbered' },
      { passage: 'never', replacement: 'rarely' }
    ];
    const result = await executeTool(replace, { edits, reference: 'mem00001' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'none of the edits was applied: in edit 2, the passage does not occur in that memory'
    });
  });

  it('takes one passage or several edits, never both', () => {
    const both = { edits: [{ passage: 'a', replacement: 'b' }], passage: 'a', reference: 'mem00001', replacement: 'b' };
    expect(replace.parameters.safeParse(both).success).toBe(false);
    expect(replace.parameters.safeParse({ passage: 'a', reference: 'mem00001' }).success).toBe(false);
  });

  it('refuses a revision over the body cap with what the memory holds and what the change would make it (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockResolvedValue(
      Result.err({
        field: 'body',
        kind: 'revision-too-long',
        length: 16_590,
        limit: 16_000,
        reference: 'mem00001',
        storedLength: 15_940
      })
    );
    const result = await executeTool(append, { reference: 'mem00001', text: 'more' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'memory mem00001 holds 15,940 of 16,000 characters, and this change would make it 16,590; shorten a passage with memory__replace, or rewrite the memory without what is no longer needed with memory__rewrite, then try again'
    });
  });

  it('rewrites a memory the turn read, disclosing the body it replaced (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockImplementation(revisingAgainst(STORED));
    await executeTool(read, { reference: 'mem00001' }, context);
    const result = await executeTool(rewrite, { body: 'numbered lists', reference: 'mem00001' }, context);
    expect(result.unwrap().disclosure).toStrictEqual({
      body: 'numbered lists',
      description: 'a stale fact',
      reference: 'mem00001',
      revision: { count: 1, replacedPassages: ['bullet points, always'] }
    });
  });

  it('refuses to rewrite a memory the turn has not read, or one revised since (§3.6)', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockImplementation(revisingAgainst(STORED));
    const unread = await executeTool(rewrite, { body: 'b', reference: 'mem00001' }, context);
    expect(unread.error).toMatchObject({ message: 'you have not read memory mem00001 in this turn; read it first' });
    await executeTool(read, { reference: 'mem00001' }, context);
    memory.revise.mockImplementation(revisingAgainst({ ...STORED, revision: 1 }));
    const stale = await executeTool(rewrite, { body: 'b', reference: 'mem00001' }, context);
    expect(stale.error).toMatchObject({
      message: 'memory mem00001 was revised since you read it; read it again first'
    });
  });

  it('counts a revision as seen only from the revision the turn had read (§3.6)', async () => {
    const { context, memory } = buildContext();
    const appended = { ...STORED, body: 'a\nb', revision: 1 };
    memory.revise.mockResolvedValue(Result.ok({ entry: appended, previous: STORED, reference: 'mem00001' }));
    memory.deleteAdmitted.mockImplementation(deletingAgainst(appended));
    await executeTool(append, { reference: 'mem00001', text: 'b' }, context);
    expect((await executeTool(deleteTool, { reference: 'mem00001' }, context)).success).toBe(false);
    await executeTool(read, { reference: 'mem00001' }, context);
    await executeTool(append, { reference: 'mem00001', text: 'b' }, context);
    expect((await executeTool(deleteTool, { reference: 'mem00001' }, context)).success).toBe(true);
  });

  it('refuses a passage found more than once without echoing the body', async () => {
    const { context, memory } = buildContext();
    memory.revise.mockResolvedValue(Result.err({ kind: 'passage-unmatched', occurrences: 'several' }));
    const result = await executeTool(replace, { passage: 'x', reference: 'mem-1', replacement: 'y' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'the passage occurs more than once in that memory; include enough of the surrounding text to match it exactly once'
    });
  });

  it('exempts only the read from the action budget (§5.3)', () => {
    expect(read.budgetExempt).toBe(true);
    expect(read.retryable).toBe(true);
    expect(write.budgetExempt).toBeUndefined();
    expect(write.retryable).toBeUndefined();
    expect(deleteTool.budgetExempt).toBeUndefined();
    expect(deleteTool.retryable).toBe(true);
    for (const revision of [append, replace, rewrite]) {
      expect([revision.budgetExempt, revision.concurrent, revision.retryable]).toStrictEqual([
        undefined,
        undefined,
        undefined
      ]);
    }
  });
});
