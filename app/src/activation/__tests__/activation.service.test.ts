import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ChannelsService } from '@/channels/channels.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { HeldActivation } from '@/turns/turns.types.ts';

import { ActivationService } from '../activation.service.ts';
import { DebounceService } from '../debounce/debounce.service.ts';

const PROFILE = { username: 'mira' } as AgentProfile;

const post = (overrides: Partial<ObservedPost> = {}): ObservedPost => {
  return createObservedPost({ mentionedUsernames: ['mira'], message: '@mira hello', ...overrides });
};

const ASSEMBLED_AT = new Date(1_000);

const ended = (status: Exclude<TurnStatus, 'running'>, windowPostIds: readonly string[] = []) => {
  return Result.ok({
    contextAssembledAt: ASSEMBLED_AT,
    status,
    turnId: 'turn-1',
    windowPostIds: new Set(windowPostIds)
  });
};

describe('ActivationService', () => {
  let activationService: ActivationService;
  let agentRegistry: MockedInstance<AgentRegistry>;
  let channelLockService: MockedInstance<ChannelLockService>;
  let conversationsService: MockedInstance<ConversationsService>;
  let debounceService: MockedInstance<DebounceService>;
  let haltService: MockedInstance<HaltService>;
  let loggingService: MockedInstance<LoggingService>;
  let multiMentionPolicy: MockedInstance<MultiMentionPolicy>;
  let notificationsService: MockedInstance<NotificationsService>;
  let queueService: MockedInstance<QueueService>;
  let reactions: string[];
  let transportRegistry: MockedInstance<TransportRegistry>;
  let triggersService: MockedInstance<TriggersService>;
  let turnFoldRegistry: TurnFoldRegistry;
  let turnRunner: MockedInstance<TurnRunner>;
  let turnsService: MockedInstance<TurnsService>;
  let typingSignals: string[];

  beforeEach(async () => {
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.isAddressedBy.mockReturnValue(true);
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.acquire.mockReturnValue({ release: () => undefined });
    const channelsService = MockFactory.createMock(ChannelsService);
    channelsService.getTriggeringMode.mockReturnValue('mention-required');
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.hasPostsObservedSince.mockResolvedValue(false);
    conversationsService.listPersonPostsFrom.mockResolvedValue([]);
    conversationsService.record.mockResolvedValue(true);
    debounceService = MockFactory.createMock(DebounceService);
    debounceService.schedule.mockImplementation((_key, onMature) => onMature());
    haltService = MockFactory.createMock(HaltService);
    haltService.isHalted.mockReturnValue(false);
    haltService.admitTurnStart.mockResolvedValue(true);
    loggingService = MockFactory.createMock(LoggingService);
    multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.addresseesOf.mockReturnValue([]);
    multiMentionPolicy.refuses.mockReturnValue(false);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
    queueService = MockFactory.createMock(QueueService);
    queueService.consumeIfUnchanged.mockResolvedValue(true);
    queueService.enqueue.mockResolvedValue(undefined);
    queueService.peek.mockResolvedValue(undefined);
    queueService.drain.mockResolvedValue(undefined);
    queueService.listAll.mockResolvedValue([]);
    queueService.pointAt.mockResolvedValue(undefined);
    reactions = [];
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.isDirectMessage.mockReturnValue(false);
    typingSignals = [];
    transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({
      addReaction: (postId: string, emoji: string) => {
        reactions.push(`${postId}:${emoji}`);
        return Promise.resolve(Result.ok());
      },
      signalTyping: (channelId: string) => typingSignals.push(channelId)
    } as never);
    triggersService = MockFactory.createMock(TriggersService);
    triggersService.peekPending.mockResolvedValue(null);
    triggersService.post.mockResolvedValue(Result.ok({ postId: 'trigger-post-1' }));
    triggersService.wasAnnouncedBy.mockResolvedValue(false);
    triggersService.listPendingChannelIds.mockResolvedValue([]);
    turnRunner = MockFactory.createMock(TurnRunner);
    turnRunner.run.mockResolvedValue(ended('completed'));
    turnsService = MockFactory.createMock(TurnsService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivationService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChannelLockService, useValue: channelLockService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: DebounceService, useValue: debounceService },
        { provide: HaltService, useValue: haltService },
        { provide: LoggingService, useValue: loggingService },
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: QueueService, useValue: queueService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService },
        TurnFoldRegistry,
        { provide: TurnRunner, useValue: turnRunner },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    activationService = moduleRef.get(ActivationService);
    turnFoldRegistry = moduleRef.get(TurnFoldRegistry);
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('should record every observed post before anything else looks at it', async () => {
    agentRegistry.isAddressedBy.mockReturnValue(false);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: [] }));
    expect(conversationsService.record).toHaveBeenCalledTimes(1);
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should run a turn for an addressed post once the debounce matures', async () => {
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledWith({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      profile: PROFILE,
      releaseHeldActivation: expect.any(Function),
      rootPostId: 'post-1',
      triggeringPostId: 'post-1'
    });
  });

  it('should queue an addressed post instead of starting a turn during a halt', async () => {
    haltService.isHalted.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should refuse the turn past the ceiling, leaving its post queued', async () => {
    haltService.admitTurnStart.mockResolvedValue(false);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should hold trigger flushes during a halt', async () => {
    haltService.isHalted.mockReturnValue(true);
    await activationService.flushTriggersIfIdle('channel-1');
    expect(triggersService.peekPending).not.toHaveBeenCalled();
  });

  it('should start no turn on the announcement the system bot posted for a trigger', async () => {
    triggersService.wasAnnouncedBy.mockResolvedValue(true);
    await activationService.onPost(PROFILE, post({ authorKind: 'system', authorUsername: 'collegium' }));
    await settle();
    expect(debounceService.schedule).not.toHaveBeenCalled();
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should refuse a multi-mention post with one correction, owned by the socket that inserted it', async () => {
    multiMentionPolicy.refuses.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    conversationsService.record.mockResolvedValue(false);
    await activationService.onPost({ username: 'owen' } as AgentProfile, post());
    expect(notificationsService.notify).toHaveBeenCalledTimes(1);
    expect(notificationsService.notify).toHaveBeenCalledWith({
      channelId: 'channel-1',
      kind: 'multi-mention-refusal'
    });
    expect(debounceService.schedule).not.toHaveBeenCalled();
  });

  it('should queue and acknowledge a post addressed to a busy agent instead of debouncing it', async () => {
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(reactions).toStrictEqual(['post-1:eyes']);
    expect(debounceService.schedule).not.toHaveBeenCalled();
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should fold an unaddressed fragment into the turn already answering that human', async () => {
    const fold = turnFoldRegistry.register({
      agentUsername: 'mira',
      authorUsername: 'casey',
      channelId: 'channel-1'
    });
    agentRegistry.isAddressedBy.mockReturnValue(false);
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: [] }));
    expect(fold.takeOffered()).toStrictEqual(['post-1']);
    expect(queueService.enqueue).not.toHaveBeenCalled();
    expect(reactions).toStrictEqual([]);
  });

  it('should queue a repeated mention rather than fold it into the running turn', async () => {
    const fold = turnFoldRegistry.register({
      agentUsername: 'mira',
      authorUsername: 'casey',
      channelId: 'channel-1'
    });
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(fold.takeOffered()).toStrictEqual([]);
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(reactions).toStrictEqual(['post-1:eyes']);
  });

  it('should fold nothing from another human into the running turn', async () => {
    const fold = turnFoldRegistry.register({
      agentUsername: 'mira',
      authorUsername: 'casey',
      channelId: 'channel-1'
    });
    agentRegistry.isAddressedBy.mockReturnValue(false);
    await activationService.onPost(PROFILE, post({ authorUsername: 'owen', mentionedUsernames: [] }));
    expect(fold.takeOffered()).toStrictEqual([]);
  });

  it('should record a post the same person addresses to a colleague as history, folding nothing (§4.4)', async () => {
    const fold = turnFoldRegistry.register({
      agentUsername: 'mira',
      authorUsername: 'casey',
      channelId: 'channel-1'
    });
    agentRegistry.isAddressedBy.mockReturnValue(false);
    multiMentionPolicy.addresseesOf.mockReturnValue(['tess']);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: ['tess'], message: '@tess run it' }));
    expect(fold.takeOffered()).toStrictEqual([]);
    expect(conversationsService.record).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it('should signal typing the moment it starts debouncing, so the window is not dark', async () => {
    await activationService.onPost(PROFILE, post());
    expect(typingSignals).toStrictEqual(['channel-1']);
  });

  it('should signal typing for an unaddressed fragment only while a window is live', async () => {
    agentRegistry.isAddressedBy.mockReturnValue(false);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: [] }));
    expect(typingSignals).toStrictEqual([]);
    debounceService.touch.mockReturnValue(true);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: [] }));
    expect(typingSignals).toStrictEqual(['channel-1']);
  });

  it('should queue nothing posted by the system bot', async () => {
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post({ authorKind: 'system' }));
    expect(queueService.enqueue).not.toHaveBeenCalled();
    expect(reactions).toStrictEqual([]);
  });

  it('should still queue a post whose acknowledgement could not be delivered, logging the failure', async () => {
    transportRegistry.get.mockReturnValue({
      addReaction: () => Promise.resolve(Result.err({ kind: 'api', message: 'rate limited' }))
    } as never);
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(loggingService.error).toHaveBeenCalledWith(
      new Error('failed to acknowledge queued post post-1: rate limited')
    );
  });

  it('should queue the post when the lock is taken between the debounce maturing and the claim', async () => {
    channelLockService.acquire.mockReturnValue(undefined);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should drain the queue into one new turn when the exit allows progress', async () => {
    // nothing is standing when the post arrives; the entry accumulates while the turn runs
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValue({ earliestUnprocessedPostId: 'post-7' } as never);
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(2);
    expect(turnRunner.run).toHaveBeenLastCalledWith({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-7',
      profile: PROFILE,
      releaseHeldActivation: expect.any(Function),
      rootPostId: 'post-7',
      triggeringPostId: 'post-7'
    });
  });

  describe("a drain covering a person's post (§5.2, §7.4)", () => {
    const LATEST_START = new Date(2_000);

    const personPost = (id: string, message: string): ModelRow<'Post'> => ({
      attachments: null,
      authoringTurnId: null,
      authorKind: 'human',
      authorUsername: 'casey',
      channelId: 'channel-1',
      createdAt: new Date(3_000),
      id,
      isForgotten: false,
      kind: 'message',
      message,
      observedAt: new Date(3_000)
    });

    beforeEach(() => {
      queueService.drain.mockResolvedValueOnce(undefined);
      queueService.peek.mockResolvedValue({ earliestUnprocessedPostId: 'post-5' } as never);
      queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-5' } as never);
      conversationsService.findActivationSource.mockImplementation((postId) => {
        return Promise.resolve(
          postId === 'post-5'
            ? {
                authorKind: 'agent',
                authorUsername: 'owen',
                delegator: undefined,
                parentChainLength: 4,
                parentDepth: 1,
                parentRootPostId: 'post-root'
              }
            : {
                authorKind: 'human',
                authorUsername: 'casey',
                delegator: undefined,
                parentChainLength: undefined,
                parentDepth: undefined,
                parentRootPostId: undefined
              }
        );
      });
      turnsService.findLatestStartIn.mockResolvedValue(LATEST_START);
      agentRegistry.isAddressedBy.mockImplementation((_profile, observed) =>
        { return observed.mentionedUsernames.includes('mira'); }
      );
    });

    it("should answer the newest person's post addressing the agent since its last turn began, in a fresh chain", async () => {
      conversationsService.listPersonPostsFrom.mockResolvedValue([
        personPost('post-9', '@tess over to you'),
        personPost('post-8', '@mira and this too'),
        personPost('post-6', '@mira first')
      ]);
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(conversationsService.listPersonPostsFrom).toHaveBeenCalledWith({
        channelId: 'channel-1',
        fromPostId: 'post-5',
        observedSince: LATEST_START
      });
      expect(turnRunner.run).toHaveBeenLastCalledWith(
        expect.objectContaining({
          chainLength: 1,
          depth: 0,
          drainedFromPostId: 'post-5',
          foldAuthorUsername: 'casey',
          rootPostId: 'post-8',
          triggeringPostId: 'post-8'
        })
      );
    });

    it('should answer the earliest queued post when looking for a person’s fails, logging it', async () => {
      conversationsService.listPersonPostsFrom.mockRejectedValue(new Error('database is locked'));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'post-5' }));
      expect(loggingService.error).toHaveBeenCalledTimes(1);
    });
  });

  it('should drain the queue after a turn ran out of context, which a fresh turn does not inherit (§7.1)', async () => {
    turnRunner.run.mockResolvedValueOnce(ended('context_exhausted'));
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(2);
  });

  describe('a queue entry the completed turn may already have read (§5.2)', () => {
    const entry = { earliestUnprocessedPostId: 'post-7', lastEnqueuedAt: new Date(1_500) };

    beforeEach(() => {
      queueService.drain.mockResolvedValueOnce(undefined);
      queueService.peek.mockResolvedValue(entry as never);
      queueService.drain.mockResolvedValueOnce(entry as never);
    });

    it('should start no second turn for posts recorded before the assembly, however late they were queued', async () => {
      turnRunner.run.mockResolvedValueOnce(ended('completed', ['post-1', 'post-7']));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(conversationsService.hasPostsObservedSince).toHaveBeenCalledWith({
        agentUsername: 'mira',
        channelId: 'channel-1',
        since: ASSEMBLED_AT
      });
      expect(queueService.consumeIfUnchanged).toHaveBeenCalledWith(entry);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should drain when a post reached the store after the assembly', async () => {
      turnRunner.run.mockResolvedValueOnce(ended('completed', ['post-1', 'post-7']));
      conversationsService.hasPostsObservedSince.mockResolvedValueOnce(true);
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(queueService.consumeIfUnchanged).not.toHaveBeenCalled();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
    });

    it('should drain when the earliest queued post was outside the window', async () => {
      turnRunner.run.mockResolvedValueOnce(ended('completed', ['post-1']));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
    });

    it('should drain after any other exit that allows progress, whatever the window held', async () => {
      turnRunner.run.mockResolvedValueOnce(ended('stopped', ['post-1', 'post-7']));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
    });
  });

  it('should absorb a queue entry left standing into the turn the next post starts', async () => {
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(turnRunner.run).toHaveBeenCalledWith({
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-7',
      profile: PROFILE,
      releaseHeldActivation: expect.any(Function),
      rootPostId: 'post-1',
      triggeringPostId: 'post-1'
    });
  });

  it('should point the queue back at the post that started a turn whose exit cannot make progress', async () => {
    turnRunner.run.mockResolvedValue(ended('provider_outage'));
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-1' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    expect(queueService.pointAt).not.toHaveBeenCalled();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(triggersService.peekPending).not.toHaveBeenCalled();
  });

  it('should point back at the earliest post the failed turn drained from, not the one that started it', async () => {
    turnRunner.run.mockResolvedValue(ended('provider_rejected'));
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-7');
  });

  it('should move a pointer a later post claimed during the failed turn back to the earlier post', async () => {
    turnRunner.run.mockResolvedValue(ended('provider_outage'));
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-9' } as never);
    conversationsService.earliestOf.mockResolvedValue('post-1');
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(conversationsService.earliestOf).toHaveBeenCalledWith(['post-9', 'post-1']);
    expect(queueService.pointAt).toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
  });

  it('should drain a human post that arrived during a failed turn into a fresh turn at once (§7.1)', async () => {
    turnRunner.run.mockResolvedValue(ended('provider_outage'));
    queueService.drain.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      earliestUnprocessedPostId: 'post-1'
    } as never);
    queueService.peek
      .mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-9' } as never)
      .mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-1' } as never);
    conversationsService.earliestOf.mockResolvedValue('post-1');
    conversationsService.findActivationSource.mockImplementation((postId) => {
      return Promise.resolve(postId === 'post-9' ? ({ authorKind: 'human' } as never) : undefined);
    });
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(2);
    expect(turnRunner.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ drainedFromPostId: 'post-1', triggeringPostId: 'post-1' })
    );
  });

  it("should leave a peer's mention standing after a failed turn until a human posts (§7.1)", async () => {
    turnRunner.run.mockResolvedValue(ended('provider_outage'));
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-9' } as never);
    conversationsService.earliestOf.mockResolvedValue('post-1');
    conversationsService.findActivationSource.mockImplementation((postId) => {
      return Promise.resolve(postId === 'post-9' ? ({ authorKind: 'agent' } as never) : undefined);
    });
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
  });

  it('should leave a pointer alone when the post it names is already the earlier one', async () => {
    turnRunner.run.mockResolvedValue(ended('provider_outage'));
    queueService.drain.mockResolvedValueOnce(undefined);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-0' } as never);
    conversationsService.earliestOf.mockResolvedValue('post-0');
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.pointAt).not.toHaveBeenCalled();
  });

  it('should leave the queue standing when a halt was raised while the turn ran', async () => {
    turnRunner.run.mockImplementation(() => {
      haltService.isHalted.mockReturnValue(true);
      return Promise.resolve(ended('completed'));
    });
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(queueService.drain).toHaveBeenCalledTimes(1);
  });

  describe('the §4.2 idle predicate', () => {
    const idleChannelHoldingATrigger = (targetAgentUsername = 'mira'): void => {
      channelLockService.isChannelIdle.mockReturnValue(true);
      debounceService.isDebouncing.mockReturnValue(false);
      triggersService.peekPending.mockResolvedValueOnce({ id: 'trigger-1', targetAgentUsername } as never);
    };

    it('should announce and start the turn under the lock when nothing holds the channel', async () => {
      channelLockService.isChannelIdle.mockReturnValue(true);
      debounceService.isDebouncing.mockReturnValue(false);
      agentRegistry.get.mockReturnValue(PROFILE);
      triggersService.peekPending.mockResolvedValueOnce({ id: 'trigger-1', targetAgentUsername: 'mira' } as never);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).toHaveBeenCalledWith('trigger-1');
      expect(turnRunner.run).toHaveBeenCalledWith(expect.objectContaining({ triggeringPostId: 'trigger-post-1' }));
    });

    it('should hold a trigger while the channel lock is taken', async () => {
      channelLockService.isChannelIdle.mockReturnValue(false);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.peekPending).not.toHaveBeenCalled();
    });

    it('should hold a trigger while a human is mid-sentence', async () => {
      channelLockService.isChannelIdle.mockReturnValue(true);
      debounceService.isDebouncing.mockReturnValue(true);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.peekPending).not.toHaveBeenCalled();
    });

    it('should hold a trigger addressed to an agent the registry does not know', async () => {
      idleChannelHoldingATrigger('ghost');
      agentRegistry.get.mockReturnValue(undefined);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).not.toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalledWith('holding a trigger for unknown agent "ghost"');
    });

    it('should hold a trigger when the lock is taken between the idle check and the claim', async () => {
      idleChannelHoldingATrigger();
      agentRegistry.get.mockReturnValue(PROFILE);
      channelLockService.acquire.mockReturnValue(undefined);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).not.toHaveBeenCalled();
    });

    it('should release the lock and hold the trigger when the ceiling refuses admission', async () => {
      let released = false;
      idleChannelHoldingATrigger();
      agentRegistry.get.mockReturnValue(PROFILE);
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      haltService.admitTurnStart.mockResolvedValue(false);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).not.toHaveBeenCalled();
      expect(released).toBe(true);
    });

    it('should release the lock when the announcement itself fails to post', async () => {
      let released = false;
      idleChannelHoldingATrigger();
      agentRegistry.get.mockReturnValue(PROFILE);
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      triggersService.post.mockResolvedValue(Result.err({ kind: 'not-pending', triggerId: 'trigger-1' }));
      await activationService.flushTriggersIfIdle('channel-1');
      expect(turnRunner.run).not.toHaveBeenCalled();
      expect(released).toBe(true);
    });
  });

  describe('posts recovered after a reconnect', () => {
    // §5.2 — a gap holds an unknown number of posts, and ten missed mentions must become one turn
    it('should queue every addressed post and drain the channel once', async () => {
      agentRegistry.get.mockReturnValue(PROFILE);
      queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-1' } as never);
      queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-1' } as never);
      const posts = [createObservedPost({ id: 'post-1' }), createObservedPost({ id: 'post-2' })];
      await activationService.onResynced(PROFILE, posts);
      await settle();
      expect(queueService.enqueue).toHaveBeenCalledTimes(2);
      expect(reactions).toStrictEqual(['post-1:eyes', 'post-2:eyes']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should leave an unaddressed post as history, starting nothing', async () => {
      agentRegistry.isAddressedBy.mockReturnValue(false);
      await activationService.onResynced(PROFILE, [createObservedPost({ id: 'post-1' })]);
      await settle();
      expect(queueService.enqueue).not.toHaveBeenCalled();
      expect(turnRunner.run).not.toHaveBeenCalled();
    });

    it("should queue nothing for a colleague's post, which the turn that wrote it releases (§5.2)", async () => {
      await activationService.onResynced(PROFILE, [
        createObservedPost({ authorKind: 'agent', authorUsername: 'owen' })
      ]);
      await settle();
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("a post an agent's turn addressed to a colleague (§5.2)", () => {
    const OWEN = { username: 'owen' } as AgentProfile;
    let owenQueue: string | undefined;

    const releasingOwen = (): void => {
      turnRunner.run.mockImplementationOnce((input) => {
        input.releaseHeldActivation({ addresseeUsername: 'owen', postId: 'post-5' } satisfies HeldActivation);
        return Promise.resolve(ended('completed'));
      });
    };

    beforeEach(() => {
      owenQueue = undefined;
      agentRegistry.get.mockReturnValue(OWEN);
      queueService.enqueue.mockImplementation((agentUsername, _channelId, postId) => {
        if (agentUsername === 'owen') {
          owenQueue ??= postId;
        }
        return Promise.resolve();
      });
      queueService.peek.mockImplementation((agentUsername) => {
        const standing = agentUsername === 'owen' ? owenQueue : undefined;
        return Promise.resolve(standing === undefined ? undefined : ({ earliestUnprocessedPostId: standing } as never));
      });
      queueService.drain.mockImplementation((agentUsername) => {
        const standing = agentUsername === 'owen' ? owenQueue : undefined;
        owenQueue = agentUsername === 'owen' ? undefined : owenQueue;
        return Promise.resolve(standing === undefined ? undefined : ({ earliestUnprocessedPostId: standing } as never));
      });
    });

    it('should start nothing when the post arrives', async () => {
      await activationService.onPost(OWEN, post({ authorKind: 'agent', authorUsername: 'mira', id: 'post-5' }));
      await settle();
      expect(debounceService.schedule).not.toHaveBeenCalled();
      expect(queueService.enqueue).not.toHaveBeenCalled();
      expect(turnRunner.run).not.toHaveBeenCalled();
    });

    it('should start the colleague from the held post once the authoring turn releases it, admitting it then (§7.4)', async () => {
      conversationsService.findActivationSource.mockResolvedValue({
        authorKind: 'agent',
        authorUsername: 'mira',
        delegator: { agentUsername: 'owen', depth: 0 },
        parentChainLength: 2,
        parentDepth: 1,
        parentRootPostId: 'post-root'
      });
      releasingOwen();
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(turnRunner.run).toHaveBeenLastCalledWith(
        expect.objectContaining({
          chainLength: 3,
          depth: 0,
          drainedFromPostId: 'post-5',
          profile: OWEN,
          rootPostId: 'post-root',
          triggeringPostId: 'post-5'
        })
      );
      expect(haltService.admitTurnStart).toHaveBeenCalledTimes(2);
      expect(reactions).toStrictEqual([]);
    });

    it('should queue and acknowledge the held post behind a busy colleague, starting nothing', async () => {
      channelLockService.isBusy.mockImplementation((agentUsername) => agentUsername === 'owen');
      releasingOwen();
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(queueService.enqueue).toHaveBeenCalledWith('owen', 'channel-1', 'post-5');
      expect(reactions).toStrictEqual(['post-5:eyes']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should leave the held post standing when the ceiling refuses it at release (§7.4)', async () => {
      haltService.admitTurnStart.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      releasingOwen();
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(owenQueue).toBe('post-5');
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('holds a restart abandoned (§7.3)', () => {
    const abandoned = { agentUsername: 'mira', channelId: 'channel-1', turnId: 'turn-9' };

    beforeEach(() => {
      conversationsService.listAuthoredBy.mockResolvedValue([
        { id: 'post-4', message: '@owen — work unit', observedAt: new Date(1_000) },
        { id: 'post-6', message: '@owen and one more thing', observedAt: new Date(3_000) }
      ]);
      multiMentionPolicy.addresseesOf.mockReturnValue(['owen']);
    });

    it('should queue the colleague at the earliest post it has had no turn here since', async () => {
      turnsService.findLatestStartIn.mockResolvedValue(new Date(2_000));
      expect(await activationService.requeueHeld([abandoned])).toBe(1);
      expect(queueService.enqueue).toHaveBeenCalledExactlyOnceWith('owen', 'channel-1', 'post-6');
    });

    it('should queue nothing once the colleague has started a turn after every post', async () => {
      turnsService.findLatestStartIn.mockResolvedValue(new Date(4_000));
      expect(await activationService.requeueHeld([abandoned])).toBe(0);
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });

    it('should queue nothing for a turn whose posts addressed no colleague', async () => {
      multiMentionPolicy.addresseesOf.mockReturnValue([]);
      expect(await activationService.requeueHeld([abandoned])).toBe(0);
      expect(turnsService.findLatestStartIn).not.toHaveBeenCalled();
    });
  });

  describe('the boot and /resume sweep', () => {
    const standingQueue = (): void => {
      agentRegistry.get.mockReturnValue(PROFILE);
      queueService.listAll.mockResolvedValue([{ agentUsername: 'mira', channelId: 'channel-1' }] as never);
      queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    };

    it('should drain a standing queue into one turn and flush every channel holding a trigger', async () => {
      standingQueue();
      queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
      channelLockService.isChannelIdle.mockReturnValue(true);
      triggersService.listPendingChannelIds.mockResolvedValue(['channel-2']);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
      expect(turnRunner.run).toHaveBeenCalledWith({
        chainLength: 1,
        channelId: 'channel-1',
        depth: 0,
        drainedFromPostId: 'post-7',
        profile: PROFILE,
        releaseHeldActivation: expect.any(Function),
        rootPostId: 'post-7',
        triggeringPostId: 'post-7'
      });
      expect(triggersService.peekPending).toHaveBeenCalledWith('channel-2');
    });

    it('should drop a standing queue entry for an agent the registry does not know', async () => {
      queueService.listAll.mockResolvedValue([{ agentUsername: 'ghost', channelId: 'channel-1' }] as never);
      agentRegistry.get.mockReturnValue(undefined);
      await activationService.sweep();
      await settle();
      expect(queueService.peek).not.toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalledWith('dropping a queue entry for unknown agent "ghost"');
    });

    it('should leave the queue standing while another turn holds the lock', async () => {
      standingQueue();
      channelLockService.acquire.mockReturnValue(undefined);
      await activationService.sweep();
      await settle();
      expect(queueService.drain).not.toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('another turn holds the lock'));
    });

    it('should leave the queue standing when the ceiling refuses the drained turn', async () => {
      let released = false;
      standingQueue();
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      haltService.admitTurnStart.mockResolvedValue(false);
      await activationService.sweep();
      await settle();
      expect(queueService.drain).not.toHaveBeenCalled();
      expect(released).toBe(true);
    });

    it('should release the lock when a concurrent activation already drained the entry', async () => {
      let released = false;
      standingQueue();
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).not.toHaveBeenCalled();
      expect(released).toBe(true);
    });
  });

  describe('turns a restart abandoned before they acted (§7.3)', () => {
    const unacted = { agentUsername: 'owen', channelId: 'channel-2', triggeringPostId: 'post-3' };

    it('should put the post that started the turn back in the queue', async () => {
      conversationsService.findActivationSource.mockResolvedValue({ authorKind: 'agent' } as never);
      expect(await activationService.requeueUnacted([unacted])).toBe(1);
      expect(queueService.enqueue).toHaveBeenCalledExactlyOnceWith('owen', 'channel-2', 'post-3');
    });

    it('should leave out a turn the system bot started (§5.2)', async () => {
      conversationsService.findActivationSource.mockResolvedValue({ authorKind: 'system' } as never);
      expect(await activationService.requeueUnacted([unacted])).toBe(0);
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });
  });

  it('should post the chain-limit correction, release the lock and queue nothing when admission refuses (§7.4)', async () => {
    let released = false;
    channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
    turnRunner.run.mockResolvedValueOnce(Result.err({ count: 3, kind: 'chain-full', limit: 3, rootPostId: 'post-0' }));
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(notificationsService.notify).toHaveBeenCalledWith({
      agentUsername: 'mira',
      channelId: 'channel-1',
      kind: 'chain-limit-refusal',
      limit: 3
    });
    expect(released).toBe(true);
    expect(queueService.enqueue).not.toHaveBeenCalled();
    expect(queueService.peek).not.toHaveBeenCalled();
    expect(triggersService.peekPending).not.toHaveBeenCalled();
  });

  it('should put back a person’s standing post a refused activation had drained, and never a peer’s mention', async () => {
    const human = { authorKind: 'human', authorUsername: 'casey', delegator: undefined } as never;
    const peer = { authorKind: 'agent', authorUsername: 'owen', delegator: undefined } as never;
    conversationsService.findActivationSource.mockImplementation((postId) => {
      return Promise.resolve(postId === 'post-7' ? human : postId === 'post-8' ? peer : undefined);
    });
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    turnRunner.run.mockResolvedValue(Result.err({ count: 3, kind: 'chain-full', limit: 3, rootPostId: 'post-0' }));
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.enqueue).toHaveBeenCalledWith('mira', 'channel-1', 'post-7');
    expect(queueService.enqueue).not.toHaveBeenCalledWith('mira', 'channel-1', 'post-1');
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-8' } as never);
    await activationService.onPost(PROFILE, post({ id: 'post-2' }));
    await settle();
    expect(queueService.enqueue).not.toHaveBeenCalledWith('mira', 'channel-1', 'post-8');
    expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('dropped the queue entry'));
  });

  it('should release the lock however the turn ended', async () => {
    let released = false;
    channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
    turnRunner.run.mockRejectedValue(new Error('boom'));
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(released).toBe(true);
  });
});
