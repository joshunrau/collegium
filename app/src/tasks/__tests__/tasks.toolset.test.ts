import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { TasksService } from '../tasks.service.ts';
import { TASKS_TOOLSET } from '../tasks.toolset.ts';

const PREPARED = {
  assigneeUsername: 'owen',
  channelId: 'channel-1',
  context: 'nothing tried yet',
  creatorUsername: 'mira',
  criteria: 'three venues with prices',
  id: 'unit-abcdefghij',
  outcome: 'a venue shortlist'
};

const ASSIGN_ARGS = {
  assignee: 'owen',
  context: 'nothing tried yet',
  criteria: 'three venues with prices',
  outcome: 'a venue shortlist'
};

describe('TASKS_TOOLSET', () => {
  const tasksService = MockFactory.createMock(TasksService);
  const context = { settings: { openUnitCap: 20, shownInPrompt: 20 }, tasks: tasksService, turn: buildToolTurnScope() };

  it('should return the assignment post addressed to the assignee, whose landing commits the unit (§3.15)', async () => {
    tasksService.prepareAssign.mockResolvedValue(
      Result.ok({ addressee: 'owen', prepared: PREPARED, text: '@owen — work unit `unit-abc`' })
    );
    tasksService.commitAssign.mockResolvedValue(undefined);
    const result = await executeTool(TASKS_TOOLSET.tools.assign, ASSIGN_ARGS, context);
    expect(result.value).toMatchObject({
      post: { addressee: 'owen', text: '@owen — work unit `unit-abc`' },
      text: 'unit unit-abc assigned to @owen'
    });
    expect(tasksService.commitAssign).not.toHaveBeenCalled();
    await result.value?.post?.onPublished('post-9');
    expect(tasksService.commitAssign).toHaveBeenCalledExactlyOnceWith(PREPARED, 'post-9');
  });

  it('should hand a refusal back as the call’s result, with nothing to publish', async () => {
    tasksService.prepareAssign.mockResolvedValue(Result.err({ assigneeUsername: 'owen', kind: 'assignee-absent' }));
    const result = await executeTool(TASKS_TOOLSET.tools.assign, ASSIGN_ARGS, context);
    expect(result.error).toStrictEqual({ kind: 'invalid-arguments', message: '@owen is not in this channel' });
  });

  it('should require the outcome, the criteria and the context of a hand-off in the schema (§3.5)', () => {
    expect(TASKS_TOOLSET.tools.assign.parameters.safeParse({ ...ASSIGN_ARGS, criteria: '' }).success).toBe(false);
    expect(TASKS_TOOLSET.tools.assign.parameters.safeParse(ASSIGN_ARGS).success).toBe(true);
  });

  it('should address a report to the creator and a close to nobody', async () => {
    tasksService.prepareReport.mockResolvedValue(
      Result.ok({
        prepared: { to: 'review', unitId: 'unit-1' },
        text: '@mira — unit `unit-1` is ready for review: done'
      })
    );
    tasksService.prepareClose.mockResolvedValue(
      Result.ok({ prepared: { to: 'done', unitId: 'unit-1' }, text: 'Unit `unit-1` closed as done: good' })
    );
    const report = await executeTool(
      TASKS_TOOLSET.tools.report,
      { reference: 'unit-1', state: 'review', summary: 'done' },
      context
    );
    const close = await executeTool(
      TASKS_TOOLSET.tools.close,
      { reference: 'unit-1', state: 'done', verdict: 'good' },
      context
    );
    expect(report.value?.post?.text).toMatch(/^@mira /);
    expect(close.value?.post?.text).not.toContain('@');
  });
});
