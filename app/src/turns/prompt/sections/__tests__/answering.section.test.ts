import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
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
import { TriggersService } from '@/triggers/triggers.service.ts';

import { TurnsService } from '../../../turns.service.ts';
import { AnsweringSection } from '../answering.section.ts';

type StoredPost = Awaited<ReturnType<ConversationsService['findUnforgotten']>> & object;

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 22, 19, minutes));

const stored = (id: string, minutes: number, overrides: Partial<StoredPost> = {}): StoredPost => ({
  authorKind: 'human',
  authorUsername: 'casey',
  createdAt: at(minutes),
  id,
  kind: 'message',
  message: `the text of ${id}`,
  observedAt: at(minutes),
  ...overrides
});

describe('AnsweringSection', () => {
  let answeringSection: AnsweringSection;
  let posts: Map<string, StoredPost>;
  let tasksService: MockedInstance<TasksService>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let triggersService: MockedInstance<TriggersService>;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    vi.useFakeTimers({ now: at(30), toFake: ['Date'] });
    posts = new Map();
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.displayNameOf.mockImplementation((username) =>
      username.replace(/^./u, (first) => first.toUpperCase())
    );
    const conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.findUnforgotten.mockImplementation((postId) => Promise.resolve(posts.get(postId)));
    tasksService = MockFactory.createMock(TasksService);
    tasksService.findReferenceOfPost.mockResolvedValue('abcd1234');
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.isGranted.mockReturnValue(true);
    triggersService = MockFactory.createMock(TriggersService);
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.findLatestStartBefore.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnsweringSection,
        DayFormatter,
        MomentFormatter,
        TextFormatter,
        TimeOfDayFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: TriggersService, useValue: triggersService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    answeringSection = moduleRef.get(AnsweringSection);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const render = (postIds: readonly string[], windowPostIds: readonly string[] = postIds) => {
    return answeringSection.render({
      answering: { postIds, turnStartedAt: at(29), windowPostIds: new Set(windowPostIds) },
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it("should list a drain's colleague report and person's post oldest first, each where it sits (§5.2)", async () => {
    posts.set('post-2', stored('post-2', 20));
    posts.set('post-1', stored('post-1', 10, { authorKind: 'agent', authorUsername: 'owen', kind: 'unit' }));
    expect(await render(['post-2', 'post-1'])).toBe(
      [
        '## Posts this turn answers',
        '- post post-1, sits above at 19:10 UTC — Owen (agent): the text of post-1\n' +
          '- post post-2, sits above at 19:20 UTC — casey (person): the text of post-2',
        'These are the posts this turn answers. Each sits above at the time it arrived, which can be before your own last messages.'
      ].join('\n\n')
    );
  });

  it('should name a trigger announcement by its id and source, and quote none of it (§4.2)', async () => {
    posts.set(
      'post-1',
      stored('post-1', 10, { authorKind: 'system', authorUsername: 'collegium', message: 'secret body' })
    );
    triggersService.findAnnouncedBy.mockResolvedValue({ id: 'trigger-1', source: 'mail' } as never);
    const text = await render(['post-1']);
    expect(text).toContain('- trigger ⟨trigger-1⟩ from mail, post post-1, sits above at 19:10 UTC.');
    expect(text).not.toContain('secret body');
  });

  it("should name the unit's reader for a unit post older than the window, else search, else quote more", async () => {
    posts.set('post-1', stored('post-1', 10, { authorKind: 'agent', authorUsername: 'owen', kind: 'unit' }));
    expect(await render(['post-1'], [])).toContain(
      'arrived at 19:10 UTC, older than your window; read its unit with tasks__read abcd1234'
    );
    toolRegistry.isGranted.mockImplementation((_profile, ref) => ref === 'conversations::search');
    expect(await render(['post-1'], [])).toContain('read it whole with conversations__search postId post-1');
    toolRegistry.isGranted.mockReturnValue(false);
    posts.set('post-1', stored('post-1', 10, { message: 'x'.repeat(2_000) }));
    const text = await render(['post-1'], []);
    expect(text).toContain(`casey (person): ${'x'.repeat(1_500)}…`);
  });

  it('should say a post arrived before the lane’s previous turn began, which may have acted on it (§5.2)', async () => {
    posts.set('post-1', stored('post-1', 10));
    turnsService.findLatestStartBefore.mockResolvedValue(at(15));
    expect(await render(['post-1'])).toContain(
      'sits above at 19:10 UTC; it arrived before your previous turn here began at 19:15 UTC, which may already have acted on it'
    );
    expect(turnsService.findLatestStartBefore).toHaveBeenCalledWith('mira', 'channel-1', at(29));
  });

  it('should list the newest five, counting the earlier ones, and cut a long post short', async () => {
    for (const minute of [1, 2, 3, 4, 5, 6, 7]) {
      posts.set(`post-${minute}`, stored(`post-${minute}`, minute, { message: 'y'.repeat(400) }));
    }
    const text = await render([...posts.keys()]);
    expect(text).not.toContain('post post-2,');
    expect(text).toContain('post post-3,');
    expect(text).toContain('…and 2 earlier ones, which sit above.');
    expect(text).toContain(`${'y'.repeat(300)}…`);
  });

  it('should leave out a forgotten post, and the section when none remains (§8.4)', async () => {
    posts.set('post-2', stored('post-2', 20));
    expect(await render(['post-1', 'post-2'])).not.toContain('post-1');
    expect(await render(['post-1'])).toBeUndefined();
  });

  it('should render nothing outside a turn, as for /collegium inspect', async () => {
    expect(
      await answeringSection.render({
        channelId: 'channel-1',
        profile: buildAgentProfile(),
        windowReachesBackTo: undefined
      })
    ).toBeUndefined();
  });
});
