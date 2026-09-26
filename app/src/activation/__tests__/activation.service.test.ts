import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { AuthorKind, TurnStatus } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { QueueService } from '@/queue/queue.service.ts';
import type { QueueEntry } from '@/queue/queue.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { ModelTable } from '@/testing/factories/model-table.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { ActivationService } from '../activation.service.ts';
import { DebounceService } from '../debounce/debounce.service.ts';

import type { DebouncedBatch } from '../debounce/debounce.service.ts';

type RunInput = Parameters<TurnRunner['run']>[0];

const PROFILE = { username: 'mira' } as AgentProfile;

const OWEN = { username: 'owen' } as AgentProfile;

const MIRA_LANE = { agentUsername: 'mira', channelId: 'channel-1' };

const post = (overrides: Partial<ObservedPost> = {}): ObservedPost => {
  return createObservedPost({ mentionedUsernames: ['mira'], message: '@mira hello', ...overrides });
};

const NO_BATCH: DebouncedBatch = { addressedPostIds: [], fragmentIds: [] };

describe('ActivationService', () => {
  let activationService: ActivationService;
  let agentRegistry: MockedInstance<AgentRegistry>;
  /** who wrote each post the store holds, and when on Mattermost's clock; a post not named here is a person's at time zero */
  let authors: Map<string, { authorKind: AuthorKind; createdAt: number }>;
  let channelLockService: MockedInstance<ChannelLockService>;
  let conversationsService: MockedInstance<ConversationsService>;
  let debounceService: MockedInstance<DebounceService>;
  let entries: ModelTable<QueueEntry>;
  let haltService: MockedInstance<HaltService>;
  let loggingService: MockedInstance<LoggingService>;
  let multiMentionPolicy: MockedInstance<MultiMentionPolicy>;
  let notificationsService: MockedInstance<NotificationsService>;
  let queueService: QueueService;
  let reactions: string[];
  let transportRegistry: MockedInstance<TransportRegistry>;
  let triggersService: MockedInstance<TriggersService>;
  let turnFoldRegistry: TurnFoldRegistry;
  let turnRunner: MockedInstance<TurnRunner>;
  let turnsService: MockedInstance<TurnsService>;
  let turnSequence: number;
  let typingSignals: string[];

  /** a turn as the runner runs one: its first assembly takes what was queued, then it ends as given */
  const endsAs = (status: Exclude<TurnStatus, 'running'>, during?: (input: RunInput) => Promise<void>) => {
    return async (input: RunInput) => {
      const turnId = `turn-${(turnSequence += 1)}`;
      await input.takeQueued?.(turnId, new Date());
      await during?.(input);
      return Result.ok({ status, turnId });
    };
  };

  const standing = async (lane = MIRA_LANE) => (await queueService.listUntaken(lane)).map((entry) => entry.postId);

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    vi.useFakeTimers({ now: 10_000, toFake: ['Date'] });
    turnSequence = 0;
    authors = new Map();
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.isAddressedBy.mockReturnValue(true);
    agentRegistry.get.mockImplementation((username) => ({ username }) as AgentProfile);
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.acquire.mockReturnValue({ release: () => undefined });
    const channelsService = MockFactory.createMock(ChannelsService);
    channelsService.getTriggeringMode.mockReturnValue('mention-required');
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.record.mockResolvedValue(true);
    conversationsService.findActivationSource.mockImplementation((postId) => {
      const author = authors.get(postId) ?? { authorKind: 'human', createdAt: 0 };
      return Promise.resolve({
        authorKind: author.authorKind,
        authorUsername: author.authorKind === 'human' ? 'casey' : 'owen',
        delegator: undefined,
        parentChainLength: undefined,
        parentDepth: undefined,
        parentRootPostId: undefined
      });
    });
    conversationsService.describeQueued.mockImplementation((postIds) => {
      return Promise.resolve(
        postIds.map((id) => {
          const author = authors.get(id) ?? { authorKind: 'human', createdAt: 0 };
          return { authorKind: author.authorKind, createdAt: new Date(author.createdAt), id };
        })
      );
    });
    debounceService = MockFactory.createMock(DebounceService);
    debounceService.schedule.mockImplementation((_key, _postId, onMature) => onMature(NO_BATCH));
    entries = createModelTable<QueueEntry>({
      defaults: (sequence) => ({ id: `entry-${sequence}`, returnedOnce: false, takenByTurnId: null }),
      uniqueFields: [['agentUsername', 'channelId', 'postId']]
    });
    haltService = MockFactory.createMock(HaltService);
    haltService.isHalted.mockReturnValue(false);
    haltService.admitTurnStart.mockResolvedValue(true);
    loggingService = MockFactory.createMock(LoggingService);
    multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.addresseesOf.mockReturnValue([]);
    multiMentionPolicy.refuses.mockReturnValue(false);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
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
    turnRunner.run.mockImplementation(endsAs('completed'));
    turnsService = MockFactory.createMock(TurnsService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivationService,
        QueueService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChannelLockService, useValue: channelLockService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: DebounceService, useValue: debounceService },
        { provide: getModelToken('QueueEntry'), useValue: entries },
        { provide: HaltService, useValue: haltService },
        { provide: LoggingService, useValue: loggingService },
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService },
        TurnFoldRegistry,
        { provide: TurnRunner, useValue: turnRunner },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    activationService = moduleRef.get(ActivationService);
    queueService = moduleRef.get(QueueService);
    turnFoldRegistry = moduleRef.get(TurnFoldRegistry);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const registerFold = (onOffered: () => void = () => undefined) => {
    return turnFoldRegistry.register({
      agentUsername: 'mira',
      authorUsername: 'casey',
      channelId: 'channel-1',
      onOffered
    });
  };

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
      activationKind: 'addressed',
      batchedFragmentIds: [],
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      foldAuthorUsername: 'casey',
      profile: PROFILE,
      releaseDeferredHandoff: expect.any(Function),
      rootPostId: 'post-1',
      takeQueued: expect.any(Function),
      triggeringPostId: 'post-1'
    });
  });

  it('should queue an addressed post instead of starting a turn during a halt', async () => {
    haltService.isHalted.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(await standing()).toStrictEqual(['post-1']);
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  it('should refuse the turn past the ceiling, leaving its post queued', async () => {
    haltService.admitTurnStart.mockResolvedValue(false);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(await standing()).toStrictEqual(['post-1']);
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
    await activationService.onPost(OWEN, post());
    expect(notificationsService.notify).toHaveBeenCalledExactlyOnceWith({
      channelId: 'channel-1',
      kind: 'multi-mention-refusal'
    });
    expect(debounceService.schedule).not.toHaveBeenCalled();
  });

  it('should queue and acknowledge a post addressed to a busy agent instead of debouncing it', async () => {
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(await standing()).toStrictEqual(['post-1']);
    expect(reactions).toStrictEqual(['post-1:eyes']);
    expect(debounceService.schedule).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      'queued post post-1 for "mira" in channel-1: its turn here holds the lane (§5.1)'
    );
  });

  it('should fold an unaddressed fragment into the turn already answering that human, queuing nothing', async () => {
    const fold = registerFold();
    agentRegistry.isAddressedBy.mockReturnValue(false);
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: [] }));
    expect(fold.takeOffered()).toStrictEqual(['post-1']);
    expect(entries.rows).toStrictEqual([]);
    expect(reactions).toStrictEqual([]);
  });

  it('should queue a repeated mention and also offer it to the turn answering that person (§4.4)', async () => {
    let queuedWhenOffered: string[] = [];
    const fold = registerFold(() => {
      queuedWhenOffered = entries.rows.map((entry) => entry.postId);
    });
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(fold.takeOffered()).toStrictEqual(['post-1']);
    expect(queuedWhenOffered).toStrictEqual(['post-1']);
    expect(reactions).toStrictEqual([]);
  });

  it('should fold nothing from another human into the running turn', async () => {
    const fold = registerFold();
    agentRegistry.isAddressedBy.mockReturnValue(false);
    await activationService.onPost(PROFILE, post({ authorUsername: 'owen', mentionedUsernames: [] }));
    expect(fold.takeOffered()).toStrictEqual([]);
  });

  it('should record a post the same person addresses to a colleague as history, folding nothing (§4.4)', async () => {
    const fold = registerFold();
    agentRegistry.isAddressedBy.mockReturnValue(false);
    multiMentionPolicy.addresseesOf.mockReturnValue(['tess']);
    await activationService.onPost(PROFILE, post({ mentionedUsernames: ['tess'], message: '@tess run it' }));
    expect(fold.takeOffered()).toStrictEqual([]);
    expect(debounceService.touch).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(entries.rows).toStrictEqual([]);
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
    await activationService.onPost(PROFILE, post({ id: 'post-2', mentionedUsernames: [] }));
    expect(debounceService.touch).toHaveBeenLastCalledWith(expect.anything(), 'post-2');
    expect(typingSignals).toStrictEqual(['channel-1']);
  });

  it('should queue nothing posted by the system bot', async () => {
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post({ authorKind: 'system' }));
    expect(entries.rows).toStrictEqual([]);
    expect(reactions).toStrictEqual([]);
  });

  it('should still queue a post whose acknowledgement could not be delivered, logging the failure', async () => {
    transportRegistry.get.mockReturnValue({
      addReaction: () => Promise.resolve(Result.err({ kind: 'api', message: 'rate limited' }))
    } as never);
    channelLockService.isBusy.mockReturnValue(true);
    await activationService.onPost(PROFILE, post());
    expect(await standing()).toStrictEqual(['post-1']);
    expect(loggingService.error).toHaveBeenCalledWith(
      new Error('failed to acknowledge queued post post-1: rate limited')
    );
  });

  it('should queue the post when the lock is taken between the debounce maturing and the claim', async () => {
    channelLockService.acquire.mockReturnValue(undefined);
    await activationService.onPost(PROFILE, post());
    await settle();
    expect(await standing()).toStrictEqual(['post-1']);
    expect(turnRunner.run).not.toHaveBeenCalled();
  });

  describe('a correction the debounce batched into the request (§4.4, §5.2)', () => {
    beforeEach(() => {
      debounceService.schedule.mockImplementation((_key, _postId, onMature) => {
        onMature({ addressedPostIds: ['post-2'], fragmentIds: ['post-3'] });
      });
    });

    it('should queue the correction before the turn starts, which the first take takes', async () => {
      let taken: readonly string[] = [];
      turnRunner.run.mockImplementationOnce(async (input) => {
        taken = (await input.takeQueued?.('turn-1', new Date())) ?? [];
        return Result.ok({ status: 'completed', turnId: 'turn-1' });
      });
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(taken).toStrictEqual(['post-2']);
      expect(turnRunner.run).toHaveBeenCalledWith(expect.objectContaining({ batchedFragmentIds: ['post-3'] }));
      expect(entries.rows).toStrictEqual([]);
    });

    it('should leave both standing after a failure, and the next drain answers both', async () => {
      turnRunner.run.mockImplementationOnce(endsAs('provider_outage'));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect((await standing()).toSorted()).toStrictEqual(['post-1', 'post-2']);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(entries.rows).toStrictEqual([]);
    });
  });

  describe('what a turn takes, and what its exit does with it (§5.2, §7.1)', () => {
    it('should consume what a completed turn took and drain a post queued after its assembly (R1)', async () => {
      authors.set('report', { authorKind: 'agent', createdAt: 5 });
      turnRunner.run.mockImplementationOnce(endsAs('completed', () => queueService.insert(MIRA_LANE, 'report')));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(turnRunner.run).toHaveBeenLastCalledWith(
        expect.objectContaining({ activationKind: 'drain', drainedFromPostId: 'report', triggeringPostId: 'report' })
      );
      expect(entries.rows).toStrictEqual([]);
    });

    it('should drain after a turn ran out of context, which a fresh turn does not inherit (§7.1)', async () => {
      turnRunner.run.mockImplementationOnce(
        endsAs('context_exhausted', () => queueService.insert(MIRA_LANE, 'post-7'))
      );
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
    });

    it.each(['stopped', 'killed', 'denied', 'context_exhausted'] as const)(
      'should consume every row a %s turn took, a folded one included (RC7)',
      async (status) => {
        await queueService.insert(MIRA_LANE, 'post-0');
        turnRunner.run.mockImplementationOnce(async (input) => {
          await input.takeQueued?.('turn-1', new Date());
          await queueService.insert(MIRA_LANE, 'folded');
          vi.advanceTimersByTime(1);
          await input.takeQueued?.('turn-1', new Date());
          return Result.ok({ status, turnId: 'turn-1' });
        });
        await activationService.onPost(PROFILE, post());
        await settle();
        expect(entries.rows).toStrictEqual([]);
        expect(turnRunner.run).toHaveBeenCalledTimes(1);
      }
    );

    it('should return what a failed turn took and queue the post it started from, leaving it standing', async () => {
      await queueService.insert(MIRA_LANE, 'post-0');
      turnRunner.run.mockImplementationOnce(endsAs('provider_outage'));
      await activationService.onPost(PROFILE, post());
      await settle();
      expect((await standing()).toSorted()).toStrictEqual(['post-0', 'post-1']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
      expect(triggersService.peekPending).not.toHaveBeenCalled();
    });

    it("should drain a person's post that arrived during a failed turn into a fresh turn at once (§7.1)", async () => {
      turnRunner.run.mockImplementationOnce(
        endsAs('provider_outage', async () => {
          vi.advanceTimersByTime(1);
          await queueService.insert(MIRA_LANE, 'post-9');
        })
      );
      authors.set('post-9', { authorKind: 'human', createdAt: 9 });
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'post-9' }));
    });

    it("should leave a colleague's post standing after a failed turn until a person posts (§7.1)", async () => {
      authors.set('post-9', { authorKind: 'agent', createdAt: 9 });
      turnRunner.run.mockImplementationOnce(
        endsAs('provider_outage', async () => {
          vi.advanceTimersByTime(1);
          await queueService.insert(MIRA_LANE, 'post-9');
        })
      );
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should leave the queue standing when a halt was raised while the turn ran', async () => {
      turnRunner.run.mockImplementationOnce(
        endsAs('completed', async () => {
          haltService.isHalted.mockReturnValue(true);
          await queueService.insert(MIRA_LANE, 'post-7');
        })
      );
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
      expect(await standing()).toStrictEqual(['post-7']);
    });

    it('should absorb what a failed exit left standing into the turn the next post starts', async () => {
      await queueService.insert(MIRA_LANE, 'post-7');
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          activationKind: 'addressed',
          drainedFromPostId: 'post-7',
          triggeringPostId: 'post-1'
        })
      );
      expect(entries.rows).toStrictEqual([]);
    });
  });

  describe("a drain covering a person's post (§5.2, §7.4)", () => {
    beforeEach(async () => {
      authors.set('report', { authorKind: 'agent', createdAt: 1 });
      authors.set('first', { authorKind: 'human', createdAt: 2 });
      authors.set('second', { authorKind: 'human', createdAt: 3 });
      for (const postId of ['report', 'second', 'first']) {
        await queueService.insert(MIRA_LANE, postId);
      }
    });

    it("should answer the newest person's post among the rows, in a fresh chain", async () => {
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          activationKind: 'sweep',
          chainLength: 1,
          depth: 0,
          drainedFromPostId: 'report',
          foldAuthorUsername: 'casey',
          rootPostId: 'second',
          triggeringPostId: 'second'
        })
      );
    });

    it('should answer it again after a failed exit returns every row (R3)', async () => {
      turnRunner.run.mockImplementationOnce(endsAs('provider_outage'));
      await activationService.sweep();
      await settle();
      expect((await standing()).toSorted()).toStrictEqual(['first', 'report', 'second']);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'second' }));
    });

    it('should answer the earliest row when reading the posts fails, logging it', async () => {
      conversationsService.describeQueued.mockRejectedValueOnce(new Error('database is locked'));
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'report' }));
      expect(loggingService.error).toHaveBeenCalledTimes(1);
    });

    it("should leave a person's post queued after the drain chose its trigger for the next turn (RC6)", async () => {
      turnRunner.run.mockImplementationOnce(async (input) => {
        vi.advanceTimersByTime(1);
        await queueService.insert(MIRA_LANE, 'late');
        vi.advanceTimersByTime(1);
        const taken = await input.takeQueued?.('turn-1', new Date());
        expect(taken?.toSorted()).toStrictEqual(['first', 'report', 'second']);
        return Result.ok({ status: 'completed', turnId: 'turn-1' });
      });
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'late' }));
    });
  });

  describe('the §4.2 idle predicate', () => {
    const idleChannelHoldingATrigger = (targetAgentUsername = 'mira'): void => {
      channelLockService.isChannelIdle.mockReturnValue(true);
      debounceService.isDebouncing.mockReturnValue(false);
      triggersService.peekPending.mockResolvedValueOnce({ id: 'trigger-1', targetAgentUsername } as never);
    };

    it('should announce and start the turn under the lock when nothing holds the channel', async () => {
      idleChannelHoldingATrigger();
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).toHaveBeenCalledWith('trigger-1');
      expect(turnRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ activationKind: 'trigger', triggeringPostId: 'trigger-post-1' })
      );
    });

    it('should take nothing into a trigger turn, leaving a standing row to the drain after it (RC6)', async () => {
      authors.set('trigger-post-1', { authorKind: 'system', createdAt: 1 });
      await queueService.insert(MIRA_LANE, 'post-7');
      idleChannelHoldingATrigger();
      await activationService.flushTriggersIfIdle('channel-1');
      await settle();
      expect(turnRunner.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ takeQueued: undefined }));
      expect(turnRunner.run).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ activationKind: 'drain', triggeringPostId: 'post-7' })
      );
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
      channelLockService.acquire.mockReturnValue(undefined);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).not.toHaveBeenCalled();
    });

    it('should release the lock and hold the trigger when the ceiling refuses admission', async () => {
      let released = false;
      idleChannelHoldingATrigger();
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      haltService.admitTurnStart.mockResolvedValue(false);
      await activationService.flushTriggersIfIdle('channel-1');
      expect(triggersService.post).not.toHaveBeenCalled();
      expect(released).toBe(true);
    });

    it('should release the lock when the announcement itself fails to post', async () => {
      let released = false;
      idleChannelHoldingATrigger();
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
      const posts = [createObservedPost({ id: 'post-1' }), createObservedPost({ id: 'post-2' })];
      await activationService.onResynced(PROFILE, posts);
      await settle();
      expect(reactions).toStrictEqual(['post-1:eyes', 'post-2:eyes']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
      expect(entries.rows).toStrictEqual([]);
    });

    it('should leave an unaddressed post as history, starting nothing', async () => {
      agentRegistry.isAddressedBy.mockReturnValue(false);
      await activationService.onResynced(PROFILE, [createObservedPost({ id: 'post-1' })]);
      await settle();
      expect(entries.rows).toStrictEqual([]);
      expect(turnRunner.run).not.toHaveBeenCalled();
    });

    it("should queue nothing for a colleague's post, which the turn that wrote it releases (§5.2)", async () => {
      await activationService.onResynced(PROFILE, [
        createObservedPost({ authorKind: 'agent', authorUsername: 'owen' })
      ]);
      await settle();
      expect(entries.rows).toStrictEqual([]);
    });
  });

  describe("posts an agent's turn addressed to a colleague (§5.2)", () => {
    const OWEN_LANE = { ...MIRA_LANE, agentUsername: 'owen' };

    const releasingToOwen = (postIds: readonly string[]): void => {
      turnRunner.run.mockImplementationOnce(
        endsAs('completed', (input) => {
          input.releaseDeferredHandoff({ addresseeUsername: 'owen', postIds });
          return settle().then(() => undefined);
        })
      );
    };

    beforeEach(() => {
      authors.set('post-5', { authorKind: 'agent', createdAt: 5 });
      authors.set('post-6', { authorKind: 'agent', createdAt: 6 });
    });

    it('should start nothing when the post arrives', async () => {
      await activationService.onPost(OWEN, post({ authorKind: 'agent', authorUsername: 'mira', id: 'post-5' }));
      await settle();
      expect(debounceService.schedule).not.toHaveBeenCalled();
      expect(entries.rows).toStrictEqual([]);
      expect(turnRunner.run).not.toHaveBeenCalled();
    });

    it('should start the colleague from the deferred post once the authoring turn releases it, admitting it then (§7.4)', async () => {
      conversationsService.findActivationSource.mockImplementation((postId) => {
        return Promise.resolve(
          postId === 'post-5'
            ? {
                authorKind: 'agent',
                authorUsername: 'mira',
                delegator: { agentUsername: 'owen', depth: 0 },
                parentChainLength: 2,
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
      releasingToOwen(['post-5']);
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(turnRunner.run).toHaveBeenCalledTimes(2);
      expect(turnRunner.run).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activationKind: 'handoff',
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

    it('should queue every post the turn addressed to its colleague, and one turn takes them all', async () => {
      let taken: readonly string[] = [];
      releasingToOwen(['post-5', 'post-6']);
      turnRunner.run.mockImplementationOnce(async (input) => {
        taken = (await input.takeQueued?.('turn-owen', new Date())) ?? [];
        return Result.ok({ status: 'completed', turnId: 'turn-owen' });
      });
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(taken).toStrictEqual(['post-5', 'post-6']);
    });

    it('should queue and acknowledge each deferred post behind a busy colleague, starting nothing', async () => {
      channelLockService.isBusy.mockImplementation((agentUsername) => agentUsername === 'owen');
      releasingToOwen(['post-5', 'post-6']);
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(await standing(OWEN_LANE)).toStrictEqual(['post-5', 'post-6']);
      expect(reactions).toStrictEqual(['post-5:eyes', 'post-6:eyes']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should leave the deferred posts standing when the ceiling refuses them at release (§7.4)', async () => {
      haltService.admitTurnStart.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      releasingToOwen(['post-5']);
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(await standing(OWEN_LANE)).toStrictEqual(['post-5']);
      expect(turnRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('hand-offs a restart abandoned (§7.3)', () => {
    const abandoned = { agentUsername: 'mira', channelId: 'channel-1', turnId: 'turn-9' };

    beforeEach(() => {
      conversationsService.listSpokenBy.mockResolvedValue([
        { id: 'post-4', message: '@owen — work unit', observedAt: new Date(1_000) },
        { id: 'post-6', message: '@owen and one more thing', observedAt: new Date(3_000) },
        { id: 'post-7', message: '@owen and the report', observedAt: new Date(4_000) }
      ]);
      multiMentionPolicy.findAddressee.mockReturnValue('owen');
    });

    it('should queue each post the colleague has had no turn here since', async () => {
      turnsService.findLatestStartIn.mockResolvedValue(new Date(2_000));
      expect(await activationService.requeueDeferred([abandoned])).toBe(1);
      expect(await standing({ ...MIRA_LANE, agentUsername: 'owen' })).toStrictEqual(['post-6', 'post-7']);
    });

    it('should queue nothing once the colleague has started a turn after every post', async () => {
      turnsService.findLatestStartIn.mockResolvedValue(new Date(5_000));
      expect(await activationService.requeueDeferred([abandoned])).toBe(0);
      expect(entries.rows).toStrictEqual([]);
    });

    it('should queue nothing for a turn whose posts addressed no colleague', async () => {
      multiMentionPolicy.findAddressee.mockReturnValue(undefined);
      expect(await activationService.requeueDeferred([abandoned])).toBe(0);
      expect(turnsService.findLatestStartIn).not.toHaveBeenCalled();
    });
  });

  describe('turns a restart abandoned (§7.3)', () => {
    const noEffects = {
      agentUsername: 'mira',
      channelId: 'channel-1',
      madeCompletion: true,
      triggeringPostId: 'ask',
      turnId: 'turn-9'
    };

    /** a drain of [colleague report, person's post], taken by the abandoned turn (R3) */
    beforeEach(async () => {
      authors.set('report', { authorKind: 'agent', createdAt: 1 });
      authors.set('ask', { authorKind: 'human', createdAt: 2 });
      await queueService.insert(MIRA_LANE, 'report');
      await queueService.insert(MIRA_LANE, 'ask');
      await queueService.take('turn-9', MIRA_LANE, new Date());
    });

    it('should return every row a turn with no effects took, and its re-run answers the same person (R3)', async () => {
      const requeue = await activationService.requeueWithoutEffects([noEffects], { unclean: false });
      expect(requeue).toStrictEqual({ notQueuedPostIds: [], requeuedTurns: 1, unannouncedTriggerIds: [] });
      expect((await standing()).toSorted()).toStrictEqual(['ask', 'report']);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ triggeringPostId: 'ask' }));
    });

    it('should return a post once after an unclean stop, and name it when a second crash cuts its turn off', async () => {
      await activationService.requeueWithoutEffects([noEffects], { unclean: true });
      await queueService.take('turn-10', MIRA_LANE, new Date());
      const second = await activationService.requeueWithoutEffects([{ ...noEffects, turnId: 'turn-10' }], {
        unclean: true
      });
      expect(second).toStrictEqual({
        notQueuedPostIds: ['report', 'ask'],
        requeuedTurns: 0,
        unannouncedTriggerIds: []
      });
      expect(entries.rows).toStrictEqual([]);
    });

    it('should return a marked row again after a clean stop, and a turn with no completion however often', async () => {
      await activationService.requeueWithoutEffects([noEffects], { unclean: true });
      await queueService.take('turn-10', MIRA_LANE, new Date());
      await activationService.requeueWithoutEffects([{ ...noEffects, turnId: 'turn-10' }], { unclean: false });
      await queueService.take('turn-11', MIRA_LANE, new Date());
      await activationService.requeueWithoutEffects([{ ...noEffects, madeCompletion: false, turnId: 'turn-11' }], {
        unclean: true
      });
      expect((await standing()).toSorted()).toStrictEqual(['ask', 'report']);
    });

    it('should send a trigger turn’s trigger back to be announced, and not the announcement into the queue (§4.2)', async () => {
      authors.set('announcement', { authorKind: 'system', createdAt: 3 });
      triggersService.reannounceAfterRestart.mockResolvedValue({ kind: 'spent', triggerId: 'trigger-1' });
      const requeue = await activationService.requeueWithoutEffects(
        [{ ...noEffects, triggeringPostId: 'announcement' }],
        {
          unclean: true
        }
      );
      expect(triggersService.reannounceAfterRestart).toHaveBeenCalledWith('announcement', { bounded: true });
      expect(requeue.unannouncedTriggerIds).toStrictEqual(['trigger-1']);
      expect(await standing()).not.toContain('announcement');
    });

    it('should consume what a turn with effects took', async () => {
      await activationService.consumeWithEffects([{ ...noEffects, triggeringPostId: undefined }]);
      expect(entries.rows).toStrictEqual([]);
    });
  });

  describe('the boot and /resume sweep', () => {
    it('should drain a standing lane into one turn and flush every channel holding a trigger', async () => {
      await queueService.insert(MIRA_LANE, 'post-7');
      await queueService.insert(MIRA_LANE, 'post-8');
      triggersService.listPendingChannelIds.mockResolvedValue(['channel-2']);
      channelLockService.isChannelIdle.mockReturnValue(true);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ activationKind: 'sweep', channelId: 'channel-1', triggeringPostId: 'post-8' })
      );
      expect(triggersService.peekPending).toHaveBeenCalledWith('channel-2');
    });

    it('should drop a standing lane of an agent the registry does not know', async () => {
      await queueService.insert({ ...MIRA_LANE, agentUsername: 'ghost' }, 'post-7');
      agentRegistry.get.mockReturnValue(undefined);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).not.toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalledWith('dropping a queue entry for unknown agent "ghost"');
    });

    it('should leave the queue standing while another turn holds the lock', async () => {
      await queueService.insert(MIRA_LANE, 'post-7');
      channelLockService.acquire.mockReturnValue(undefined);
      await activationService.sweep();
      await settle();
      expect(await standing()).toStrictEqual(['post-7']);
      expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('another turn holds the lock'));
    });

    it('should leave the queue standing when the ceiling refuses the drained turn', async () => {
      let released = false;
      await queueService.insert(MIRA_LANE, 'post-7');
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      haltService.admitTurnStart.mockResolvedValue(false);
      await activationService.sweep();
      await settle();
      expect(await standing()).toStrictEqual(['post-7']);
      expect(released).toBe(true);
    });

    it('should start no turn for a lane whose only post was forgotten (§8.4)', async () => {
      await queueService.insert(MIRA_LANE, 'post-7');
      await queueService.deletePosts(['post-7']);
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).not.toHaveBeenCalled();
    });
  });

  describe('the chain limit (§7.4)', () => {
    const refused = () => Result.err({ count: 3, kind: 'chain-full' as const, limit: 3, rootPostId: 'post-0' });

    it('should post the correction, release the lock and take nothing when admission refuses', async () => {
      let released = false;
      channelLockService.acquire.mockReturnValue({ release: () => (released = true) });
      turnRunner.run.mockResolvedValueOnce(refused());
      await activationService.onPost(PROFILE, post());
      await settle();
      expect(notificationsService.notify).toHaveBeenCalledWith({
        agentUsername: 'mira',
        channelId: 'channel-1',
        kind: 'chain-limit-refusal',
        limit: 3
      });
      expect(released).toBe(true);
      expect(entries.rows).toStrictEqual([]);
      expect(triggersService.peekPending).not.toHaveBeenCalled();
    });

    it("should clear a lane of colleagues' posts it refused, which every sweep would refuse again", async () => {
      authors.set('report', { authorKind: 'agent', createdAt: 1 });
      await queueService.insert(MIRA_LANE, 'report');
      turnRunner.run.mockResolvedValueOnce(refused());
      await activationService.sweep();
      await settle();
      expect(entries.rows).toStrictEqual([]);
      expect(loggingService.warn).toHaveBeenCalledWith(expect.stringContaining('dropped the queue for "mira"'));
    });

    it("should keep a person's post standing and drain it, since it starts a fresh chain", async () => {
      authors.set('report', { authorKind: 'agent', createdAt: 1 });
      await queueService.insert(MIRA_LANE, 'report');
      turnRunner.run.mockImplementationOnce(async () => {
        await queueService.insert(MIRA_LANE, 'ask');
        return refused();
      });
      await activationService.sweep();
      await settle();
      expect(turnRunner.run).toHaveBeenLastCalledWith(expect.objectContaining({ triggeringPostId: 'ask' }));
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
