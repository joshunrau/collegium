import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { SchedulesRegistry } from '@/schedules/schedules.registry.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { PromptRenderer } from '@/turns/context/prompt.renderer.ts';

import { InspectHandler } from '../inspect.handler.ts';

const MIRA = buildAgentProfile();

/** what `preventWrappingAtHyphens` inserts, so an expectation reads as the name an operator sees */
const JOINER = '⁠';

describe('InspectHandler', () => {
  let promptRenderer: MockedInstance<PromptRenderer>;
  let inspectHandler: InspectHandler;

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    promptRenderer = MockFactory.createMock(PromptRenderer);
    promptRenderer.render.mockResolvedValue('You are Mira.');
    const skillsService = MockFactory.createMock(SkillsService);
    skillsService.listFor.mockReturnValue([{ description: 'How to hand work over.', name: 'handing-work-to-a-peer' }]);
    const dateFormatter = MockFactory.createMock(DateFormatter);
    dateFormatter.format.mockReturnValue('September 18, 2026 at 9:00:00 AM UTC');
    const schedulesRegistry = MockFactory.createMock(SchedulesRegistry);
    schedulesRegistry.listUpcomingFor.mockReturnValue([
      { channel: 'ops', handle: 'morning-sweep', nextOccurrenceAt: new Date('2026-09-18T09:00:00Z') }
    ]);
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listFor.mockReturnValue([
      { gates: false, id: ['clock', 'now'] },
      { gates: true, id: ['shell', 'run'] }
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        InspectHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: DateFormatter, useValue: dateFormatter },
        { provide: SchedulesRegistry, useValue: schedulesRegistry },
        { provide: PromptRenderer, useValue: promptRenderer },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    inspectHandler = moduleRef.get(InspectHandler);
  });

  it('should report the agent with the prompt it would receive in this channel, to the caller alone', async () => {
    const response = await inspectHandler.handle({
      channelId: 'channel-1',
      text: ' mira ',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(promptRenderer.render).toHaveBeenCalledWith({ channelId: 'channel-1', profile: MIRA });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: [
        '### @mira',
        '',
        '#### Profile',
        '',
        '| Setting | Value |',
        '| --- | --- |',
        '| **Expertise** | end-to-end testing |',
        '| **Model** | `deepseek-v4-flash` (deepseek) |',
        '| **Context Budget** | 8,000 tokens |',
        '| **Action Budget** | 25 attempts per turn |',
        '',
        '#### Tools',
        '',
        '| Toolset | Tools |',
        '| --- | --- |',
        '| **`clock`** | `now` |',
        '| **`shell`** | `run`\\* |',
        '',
        '_\\* Requires human approval on every call (§3.7)._',
        '',
        '#### Skills',
        '',
        '| Source | Skill | Description |',
        '| --- | --- | --- |',
        `| **\`framework\`** | \`handing-${JOINER}work-${JOINER}to-${JOINER}a-${JOINER}peer\` | How to hand work over. |`,
        '',
        '#### Schedules',
        '',
        '| Schedule | Channel | Next Occurrence |',
        '| --- | --- | --- |',
        `| **\`morning-${JOINER}sweep\`** | ~ops | September 18, 2026 at 9:00:00 AM UTC |`,
        '',
        '#### Prompt in This Channel',
        '',
        '> You are Mira.'
      ].join('\n')
    });
  });

  it('should refuse an unknown agent', async () => {
    const response = await inspectHandler.handle({
      channelId: 'channel-1',
      text: 'dana',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'No agent "dana". Usage: /collegium inspect {agent}'
    });
  });

  it('should refuse trailing arguments with the usage line', async () => {
    const response = await inspectHandler.handle({
      channelId: 'channel-1',
      text: 'mira now',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /collegium inspect {agent}' });
  });
});
