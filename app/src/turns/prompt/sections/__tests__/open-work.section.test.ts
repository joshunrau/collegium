import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
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
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.settingsFor.mockReturnValue(undefined);
    tasksService = MockFactory.createMock(TasksService);
    tasksService.listOpenFor.mockResolvedValue([]);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listFor.mockReturnValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenWorkSection,
        TextFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    openWorkSection = moduleRef.get(OpenWorkSection);
  });

  const render = () => {
    return openWorkSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should list open work for an agent holding a tasks tool, oldest first, capped with a remainder (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    agentRegistry.settingsFor.mockReturnValue({ openUnitCap: 20, shownInPrompt: 1 });
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date(Date.now() - 2 * 3_600_000),
        creatorUsername: 'mira',
        outcome: 'a schedule for the offsite',
        reference: 'abcd1234',
        state: 'assigned'
      },
      {
        assigneeUsername: 'mira',
        createdAt: new Date(),
        creatorUsername: 'tess',
        outcome: 'a venue shortlist',
        reference: 'efgh5678',
        state: 'review'
      }
    ]);
    expect(await render()).toContain(
      '## Open work\n\nWork handed over in this channel and still open, oldest first. A line marked `to @name` is one you assigned and are waiting on; `from @name` is one you owe. Read one in full with tasks__read:\n\n- [abcd1234] to @tess · assigned · 2h 0m — a schedule for the offsite\n\n…and 1 more.'
    );
    expect(tasksService.listOpenFor).toHaveBeenCalledWith({ agentUsername: 'mira', channelId: 'channel-1' });
  });

  it('should state that no work is open rather than omit the section, for an agent holding a tasks tool (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    expect(await render()).toContain('## Open work\n\nNo work is open in this channel.');
  });

  it('should omit open work for an agent holding no tasks tool (§3.15)', async () => {
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date(),
        creatorUsername: 'mira',
        outcome: 'anything',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    expect(await render()).toBeUndefined();
    expect(tasksService.listOpenFor).not.toHaveBeenCalled();
  });
});
