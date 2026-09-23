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
  followsId: null,
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
  const agents = {
    displayNameOf: (username: string) => username.replace(/^./u, (first) => first.toUpperCase()),
    has: (username: string) => ['mira', 'owen'].includes(username)
  };
  const moments = { format: (moment: Date) => `${moment.toISOString().slice(11, 16)} UTC` };
  const sightings = new PostSightingsRegistry();
  const tasksService = MockFactory.createMock(TasksService);
  const context = {
    agents,
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
      text: 'unit unit-abc assigned to Owen, whose turn starts when this turn ends; the assignment is posted, so your reply need not repeat it'
    });
    expect(tasksService.commitAssign).not.toHaveBeenCalled();
    await result.value?.post?.onPublished('post-9');
    expect(tasksService.commitAssign).toHaveBeenCalledExactlyOnceWith(PREPARED, 'post-9');
  });

  it('should pass the unit an assignment follows, and say the one post closed it and continued it (§3.15)', async () => {
    const prepared = { ...PREPARED, followsId: 'unit-xyzwvuts' };
    tasksService.prepareAssign.mockResolvedValue(Result.ok({ addressee: 'owen', prepared, text: 'post' }));
    const result = await executeTool(TASKS_TOOLSET.tools.assign, { ...ASSIGN_ARGS, follows: 'unit-xyz' }, context);
    expect(tasksService.prepareAssign).toHaveBeenCalledWith(expect.objectContaining({ follows: 'unit-xyz' }));
    expect(result.value?.text).toBe(
      'unit unit-xyz closed as done and continued as unit unit-abc assigned to Owen, whose turn starts when this turn ends; the post is in the channel, so your reply need not repeat it'
    );
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
      Result.ok({
        leavesNoneOpen: false,
        prepared: { to: 'done', unitId: 'unit-1' },
        text: 'Unit `unit-1` closed as done: good'
      })
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
    expect(report.value?.text).toContain('the report is posted to Mira, whose turn starts when this turn ends');
    expect(close.value?.post?.text).not.toContain('@');
    expect(close.value?.text).toBe('unit unit-1 closed as done; the close is posted, so your reply need not repeat it');
  });

  it('should say a close leaves the agent nothing open here that would start its next turn (§3.15)', async () => {
    tasksService.prepareClose.mockResolvedValue(
      Result.ok({ leavesNoneOpen: true, prepared: { to: 'done', unitId: 'unit-1' }, text: 'closed' })
    );
    const close = await executeTool(
      TASKS_TOOLSET.tools.close,
      { reference: 'unit-1', state: 'done', verdict: 'good' },
      context
    );
    expect(close.value?.text).toContain(
      'You hold no other open unit in this channel; no turn of yours starts here until a post addresses you'
    );
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
      message: 'unit unit-1 is closed: Mira closed it as cancelled 5m ago, with the verdict "no longer needed"'
    });
  });

  it('should name the next step in a refused report, and the open units for a reference that matches none (§7.2)', async () => {
    tasksService.prepareReport.mockResolvedValueOnce(
      Result.err({ creatorUsername: 'mira', kind: 'awaiting-verdict', reference: 'unit-1', state: 'review' })
    );
    tasksService.prepareReport.mockResolvedValueOnce(
      Result.err({ kind: 'not-found', openReferences: ['unit-abc'], reference: 'i3521kmu0000000000000000' })
    );
    const report = () => {
      return executeTool(TASKS_TOOLSET.tools.report, { reference: 'unit-1', state: 'review', summary: 'x' }, context);
    };
    expect((await report()).error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'unit unit-1 is in review with Mira for judgement, and takes no further report: a correction goes in a post mentioning @mira, or Mira continues the unit with a new one that follows it'
    });
    expect((await report()).error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'no work unit with reference "i3521kmu0000000000000000" exists for you in this channel; your open units here: unit-abc. A work unit is named by the 8 characters Open work lists in brackets; an id of 24 characters that matches none here is some other record\'s'
    });
  });

  it('should name a person who cancelled a unit by @username, and point a refused report at its creator (§3.15)', async () => {
    tasksService.prepareReport.mockResolvedValue(
      Result.err({
        closed: {
          closedAt: new Date(Date.now() - 5 * 60_000),
          closedByUsername: 'casey',
          kind: 'closed',
          reference: 'unit-1',
          state: 'cancelled',
          verdict: null
        },
        creatorUsername: 'mira',
        kind: 'report-closed'
      })
    );
    const report = await executeTool(
      TASKS_TOOLSET.tools.report,
      { reference: 'unit-1', state: 'review', summary: 'x' },
      context
    );
    expect(report.error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'unit unit-1 is closed: @casey closed it as cancelled 5m ago. It takes no report; if what you found still matters to Mira, it goes in a post mentioning @mira'
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
        'creator: Mira',
        'assignee: Owen (awaiting your verdict since 19:02 UTC)',
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

  it('should name the unit one follows, and count nothing as read where the latest post can no longer be shown (§8.4)', async () => {
    tasksService.readView.mockResolvedValue(
      Result.ok({
        counterpart: undefined,
        latestChange: { kind: 'unreadable' },
        unit: { ...UNIT, followsId: 'unit-xyzwvuts', lastPostId: 'p-2' }
      })
    );
    const read = await executeTool(TASKS_TOOLSET.tools.read, { reference: 'unit-abc' }, context);
    expect(read.value?.text).toMatch(/^unit unit-abc — review\nfollows: unit unit-xyz\n/u);
    expect(read.value?.text).toContain('latest report: its post was forgotten, so it can no longer be read');
    expect(sightings.hasSeen('turn-1', 'p-2')).toBe(false);
  });
});
