import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import { TimeOfDayFormatter } from '@/formatting/dates/time-of-day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { OpenWorkSection } from '../open-work.section.ts';

describe('OpenWorkSection', () => {
  let agentRegistry: MockedInstance<AgentRegistry>;
  let openWorkSection: OpenWorkSection;
  let tasksService: MockedInstance<TasksService>;
  let toolRegistry: MockedInstance<ToolRegistry>;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-09-22T19:10:00Z'), toFake: ['Date'] });
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.settingsFor.mockReturnValue(undefined);
    agentRegistry.has.mockReturnValue(true);
    agentRegistry.displayNameOf.mockImplementation((username) => {
      return username.replace(/^./u, (first) => first.toUpperCase());
    });
    tasksService = MockFactory.createMock(TasksService);
    tasksService.listOpenFor.mockResolvedValue([]);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listFor.mockReturnValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DayFormatter,
        MomentFormatter,
        OpenWorkSection,
        TextFormatter,
        TimeOfDayFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    openWorkSection = moduleRef.get(OpenWorkSection);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const render = () => {
    return openWorkSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should list open work for an agent holding a tasks tool, oldest first, capped with a remainder, then what starts its next turn (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    agentRegistry.settingsFor.mockReturnValue({ openUnitCap: 20, shownInPrompt: 1 });
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        counterpart: {
          awaited: 'report',
          beganBeforeChange: false,
          kind: 'in-turn',
          since: new Date('2026-09-22T18:55:00Z'),
          waitingOn: undefined
        },
        createdAt: new Date(Date.now() - 2 * 3_600_000),
        creatorUsername: 'mira',
        follows: undefined,
        outcome: 'a schedule for the offsite',
        reference: 'abcd1234',
        state: 'assigned'
      },
      {
        assigneeUsername: 'mira',
        counterpart: { awaited: 'verdict', kind: 'no-turn' },
        createdAt: new Date(),
        creatorUsername: 'tess',
        follows: undefined,
        outcome: 'a venue shortlist',
        reference: 'efgh5678',
        state: 'review'
      }
    ]);
    expect(await render()).toBe(
      '## Open work\n\nWork handed over in this channel and still open, oldest first. A line that reads `to` a colleague is one you assigned and are waiting on; `from` a colleague, one you owe. In brackets is where that colleague stood as this turn began. Read one in full with tasks__read:\n\n- [abcd1234] to Tess (working here since 18:55 UTC) · assigned · 2h 0m — a schedule for the offsite\n\n…and 1 more.\n\nA unit starts no turn by itself: its assignment or report does, by mentioning whoever must act next. Nothing starts another turn of yours here until a person posts, a colleague mentions you, or a trigger fires.'
    );
    expect(tasksService.listOpenFor).toHaveBeenCalledWith({ agentUsername: 'mira', channelId: 'channel-1' });
  });

  it('should word the counterpart’s state for the agent reading it, naming a person it waits on (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    const unit = {
      assigneeUsername: 'tess',
      createdAt: new Date('2026-09-22T18:00:00Z'),
      creatorUsername: 'mira',
      follows: undefined,
      outcome: 'a venue shortlist',
      reference: 'abcd1234',
      state: 'assigned'
    } as const;
    tasksService.listOpenFor.mockResolvedValue([
      {
        ...unit,
        counterpart: {
          awaited: 'report',
          beganBeforeChange: true,
          kind: 'in-turn',
          since: new Date('2026-09-22T17:50:00Z'),
          waitingOn: { on: 'approval', since: new Date('2026-09-22T18:57:00Z') }
        }
      },
      { ...unit, counterpart: { awaited: 'report', endedAt: new Date('2026-09-21T19:02:00Z'), kind: 'turn-ended' } },
      {
        ...unit,
        counterpart: { awaited: 'verdict', kind: 'awaiting-reader', since: new Date('2026-09-22T19:02:00Z') },
        state: 'review'
      }
    ]);
    const rendered = await render();
    expect(rendered).toContain(
      'to Tess (waiting on a decision since 18:57 UTC, in a turn begun before the assignment)'
    );
    expect(rendered).toContain(
      'to Tess (last turn here ended 19:02 UTC on Monday, September 21, 2026 without reporting)'
    );
    expect(rendered).toContain('to Tess (awaiting your verdict since 19:02 UTC)');
  });

  it('should state that no work is open, and what starts the next turn, rather than omit the section (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    expect(await render()).toBe(
      '## Open work\n\nNo work is open in this channel. Nothing starts another turn of yours here until a person posts, a colleague mentions you, or a trigger fires.'
    );
  });

  it('should name the unit a line’s unit follows (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'mira',
        counterpart: { awaited: 'report', kind: 'awaiting-reader', since: new Date('2026-09-22T19:00:00Z') },
        createdAt: new Date('2026-09-22T19:00:00Z'),
        creatorUsername: 'tess',
        follows: 'wxyz9876',
        outcome: 'the second half of the venue list',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    expect(await render()).toContain(
      '- [abcd1234] from Tess (awaiting your report since 19:00 UTC) · assigned · 10m · follows wxyz9876 — the second half of the venue list'
    );
  });

  it('should omit open work for an agent holding no tasks tool (§3.15)', async () => {
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        counterpart: { awaited: 'report', kind: 'no-turn' },
        createdAt: new Date(),
        creatorUsername: 'mira',
        follows: undefined,
        outcome: 'anything',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    expect(await render()).toBeUndefined();
    expect(tasksService.listOpenFor).not.toHaveBeenCalled();
  });
});
