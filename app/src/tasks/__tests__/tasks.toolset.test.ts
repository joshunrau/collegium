import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { PostSightingsRegistry } from '../sightings/post-sightings.registry.ts';
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

const UNIT = {
  ...PREPARED,
  closedAt: null,
  closedByUsername: null,
  createdAt: new Date('2026-09-22T18:40:00Z'),
  lastPostId: 'post-report',
  originPostId: 'post-assign',
  state: 'review',
  updatedAt: new Date('2026-09-22T19:02:00Z'),
  verdict: null
} as const;

describe('TASKS_TOOLSET', () => {
  const moments = { format: (moment: Date) => `${moment.toISOString().slice(11, 16)} UTC` };
  const sightings = new PostSightingsRegistry();
  const tasksService = MockFactory.createMock(TasksService);
  const context = {
    moments,
    settings: { openUnitCap: 20, shownInPrompt: 20 },
    sightings,
    tasks: tasksService,
    turn: buildToolTurnScope()
  };

  it('should return the assignment post addressed to the assignee, whose landing commits the unit (§3.15)', async () => {
    tasksService.prepareAssign.mockResolvedValue(
      Result.ok({ addressee: 'owen', prepared: PREPARED, text: '@owen — work unit `unit-abc`' })
    );
    tasksService.commitAssign.mockResolvedValue(undefined);
    const result = await executeTool(TASKS_TOOLSET.tools.assign, ASSIGN_ARGS, context);
    expect(result.value).toMatchObject({
      post: { addressee: 'owen', text: '@owen — work unit `unit-abc`' },
      text: 'unit unit-abc assigned to @owen, whose turn starts when this turn ends'
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
        addressee: 'mira',
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

  it('should close for the calling turn, and refuse on a closed unit naming who closed it, when and the verdict (§3.15)', async () => {
    tasksService.prepareClose.mockResolvedValue(
      Result.err({
        closedAt: new Date(Date.now() - 5 * 60_000),
        closedByUsername: 'mira',
        kind: 'closed',
        reference: 'unit-1',
        state: 'cancelled',
        verdict: 'no longer needed'
      })
    );
    const close = await executeTool(
      TASKS_TOOLSET.tools.close,
      { reference: 'unit-1', state: 'done', verdict: 'good' },
      context
    );
    expect(tasksService.prepareClose).toHaveBeenCalledWith(expect.objectContaining({ turnId: 'turn-1' }));
    expect(close.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'unit unit-1 is closed: @mira closed it as cancelled 5m ago, with the verdict "no longer needed"'
    });
  });

  it('should show a unit’s latest report and where its counterpart stands, and count the report as read (§3.15)', async () => {
    tasksService.readView.mockResolvedValue(
      Result.ok({
        counterpart: { awaited: 'verdict', kind: 'awaiting-reader', since: UNIT.updatedAt },
        latestChange: {
          kind: 'posted',
          post: { createdAt: UNIT.updatedAt, id: 'post-report', message: '@mira — unit is ready for review: done' }
        },
        unit: UNIT
      })
    );
    const read = await executeTool(TASKS_TOOLSET.tools.read, { reference: 'unit-abc' }, context);
    expect(read.value?.text).toBe(
      [
        'unit unit-abc — review',
        'assigned 18:40 UTC, last changed 19:02 UTC',
        'creator: @mira',
        'assignee: @owen (awaiting your verdict since 19:02 UTC)',
        'outcome: a venue shortlist',
        'criteria: three venues with prices',
        'context: nothing tried yet',
        '',
        'latest report:',
        '<<<post post-report',
        '@mira — unit is ready for review: done',
        '>>>'
      ].join('\n')
    );
    expect(sightings.hasSeen('turn-1', 'post-report')).toBe(true);
  });

  it('should count nothing as read where the latest post can no longer be shown (§8.4)', async () => {
    tasksService.readView.mockResolvedValue(
      Result.ok({ counterpart: undefined, latestChange: { kind: 'unreadable' }, unit: { ...UNIT, lastPostId: 'p-2' } })
    );
    const read = await executeTool(TASKS_TOOLSET.tools.read, { reference: 'unit-abc' }, context);
    expect(read.value?.text).toContain('latest report: its post was forgotten, so it can no longer be read');
    expect(sightings.hasSeen('turn-1', 'p-2')).toBe(false);
  });
});
