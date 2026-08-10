import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ChannelsService } from '@/channels/channels.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';

import { ActivationService } from '../activation.service.ts';
import { DebounceService } from '../debounce/debounce.service.ts';

const PROFILE = { username: 'mira' } as AgentProfile;

const post = (overrides: Partial<ObservedPost> = {}): ObservedPost =>
  createObservedPost({ mentionedUsernames: ['mira'], message: '@mira hello', ...overrides });

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
  let typingSignals: string[];

  beforeEach(async () => {
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.isAddressedBy.mockReturnValue(true);
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.acquire.mockReturnValue({ release: () => undefined });
    const channelsService = MockFactory.createMock(ChannelsService);
    channelsService.getTriggerMode.mockReturnValue('mention-required');
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.record.mockResolvedValue(true);
    debounceService = MockFactory.createMock(DebounceService);
    debounceService.schedule.mockImplementation((_key, onMature) => onMature());
    haltService = MockFactory.createMock(HaltService);
    haltService.isHalted.mockReturnValue(false);
    haltService.admitTurnStart.mockResolvedValue(true);
    loggingService = MockFactory.createMock(LoggingService);
    multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.refuses.mockReturnValue(false);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
    queueService = MockFactory.createMock(QueueService);
    queueService.enqueue.mockResolvedValue(undefined);
    queueService.peek.mockResolvedValue(undefined);
    queueService.drain.mockResolvedValue(undefined);
    queueService.listAll.mockResolvedValue([]);
    reactions = [];
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
    turnRunner.run.mockResolvedValue({ status: 'completed', turnId: 'turn-1' });
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
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService },
        TurnFoldRegistry,
        { provide: TurnRunner, useValue: turnRunner }
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
      channelId: 'channel-1',
      depth: 0,
      profile: PROFILE,
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

  it('should start a trigger-initiated turn at depth one', async () => {
    conversationsService.findActivationSource.mockResolvedValue({
      authorKind: 'system',
      authorUsername: 'collegium',
      parentDepth: undefined
    });
    await activationService.onPost(PROFILE, post({ authorKind: 'system', authorUsername: 'collegium' }));
    await settle();
    expect(turnRunner.run).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 }));
  });

  it('should start an agent-initiated turn one deeper than the turn that authored the mention', async () => {
    conversationsService.findActivationSource.mockResolvedValue({
      authorKind: 'agent',
      authorUsername: 'owen',
      parentDepth: 4
    });
    await activationService.onPost(PROFILE, post({ authorKind: 'agent', authorUsername: 'owen' }));
    await settle();
    expect(turnRunner.run).toHaveBeenCalledWith(expect.objectContaining({ depth: 5 }));
  });

  it('should start an agent-initiated turn at depth one when no authoring turn is recoverable', async () => {
    conversationsService.findActivationSource.mockResolvedValue({
      authorKind: 'agent',
      authorUsername: 'owen',
      parentDepth: undefined
    });
    await activationService.onPost(PROFILE, post({ authorKind: 'agent', authorUsername: 'owen' }));
    await settle();
    expect(turnRunner.run).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 }));
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
    queueService.peek.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(2);
    expect(turnRunner.run).toHaveBeenLastCalledWith({
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-7',
      profile: PROFILE,
      triggeringPostId: 'post-7'
    });
  });

  it('should absorb a queue entry left standing into the turn the next post starts', async () => {
    queueService.drain.mockResolvedValueOnce({ earliestUnprocessedPostId: 'post-7' } as never);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(turnRunner.run).toHaveBeenCalledWith({
      channelId: 'channel-1',
      depth: 0,
      drainedFromPostId: 'post-7',
      profile: PROFILE,
      triggeringPostId: 'post-1'
    });
  });

  it('should leave the queue standing when the turn exit cannot make progress', async () => {
    turnRunner.run.mockResolvedValue({ status: 'provider_outage', turnId: 'turn-1' });
    queueService.drain.mockResolvedValueOnce(undefined);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(queueService.peek).not.toHaveBeenCalled();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(triggersService.peekPending).not.toHaveBeenCalled();
  });

  it('should leave the queue standing when a halt was raised while the turn ran', async () => {
    turnRunner.run.mockImplementation(() => {
      haltService.isHalted.mockReturnValue(true);
      return Promise.resolve({ status: 'completed', turnId: 'turn-1' });
    });
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(turnRunner.run).toHaveBeenCalledTimes(1);
    expect(queueService.peek).not.toHaveBeenCalled();
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
        channelId: 'channel-1',
        depth: 0,
        drainedFromPostId: 'post-7',
        profile: PROFILE,
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

  it('should release the lock however the turn ended', async () => {
    let released = false;
    channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
    turnRunner.run.mockRejectedValue(new Error('boom'));
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(released).toBe(true);
  });
});
