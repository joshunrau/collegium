import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import type { Announcement } from '@/notifications/announcing/announcing.types.ts';
import { ChannelAnnouncer } from '@/notifications/announcing/channel-announcer.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ClearingService } from '../clearing.service.ts';
import { ChannelErasure } from '../erasure/channel-erasure.service.ts';

const MIRA = { username: 'mira' } as AgentProfile;
const JO = { username: 'jo' } as AgentProfile;

const REQUEST = { byUsername: 'casey', channelId: 'channel-1', memories: false };

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ClearingService', () => {
  let announced: Announcement & { edit: ReturnType<typeof vi.fn> };
  let callbackSigner: MockedInstance<CallbackSigner>;
  let channelAnnouncer: MockedInstance<ChannelAnnouncer>;
  let channelErasure: MockedInstance<ChannelErasure>;
  let channelLockService: MockedInstance<ChannelLockService>;
  let chatGateway: MockedInstance<ChatGateway>;
  let clearingService: ClearingService;
  let conversationsService: MockedInstance<ConversationsService>;
  let loggingService: MockedInstance<LoggingService>;
  let memoryService: MockedInstance<MemoryService>;
  let released: string[];
  let rosterService: MockedInstance<RosterService>;
  let transport: MockedInstance<ChatTransport>;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    announced = {
      authorKind: 'system',
      authorUsername: 'collegium',
      createdAt: new Date(5000),
      edit: vi.fn(() => Promise.resolve(Result.ok())),
      postId: 'notice-1'
    };
    released = [];
    callbackSigner = MockFactory.createMock(CallbackSigner);
    callbackSigner.sign.mockReturnValue('signed');
    channelAnnouncer = MockFactory.createMock(ChannelAnnouncer);
    channelAnnouncer.announce.mockResolvedValue(announced);
    channelErasure = MockFactory.createMock(ChannelErasure);
    channelErasure.erase.mockResolvedValue([]);
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.listHeld.mockReturnValue([]);
    channelLockService.acquire.mockImplementation((agentUsername: string) => ({
      release: () => released.push(agentUsername)
    }));
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.erasePostsBefore.mockResolvedValue(Result.ok({ deleted: 3, failed: 0 }));
    chatGateway.openDialogAsSystem.mockResolvedValue(Result.ok());
    conversationsService = MockFactory.createMock(ConversationsService);
    loggingService = MockFactory.createMock(LoggingService);
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.deleteMany.mockResolvedValue(2);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockReturnValue([MIRA, JO]);
    transport = MockFactory.createMock(ChatTransport);
    transport.openDialog.mockResolvedValue(Result.ok());
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    windowService = MockFactory.createMock(WindowService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClearingService,
        { provide: CallbackSigner, useValue: callbackSigner },
        { provide: ChannelAnnouncer, useValue: channelAnnouncer },
        { provide: ChannelErasure, useValue: channelErasure },
        { provide: ChannelLockService, useValue: channelLockService },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: EnvService, useValue: createEnvServiceMock({ APP_PUBLIC_URL: 'http://app.test/' }) },
        { provide: LoggingService, useValue: loggingService },
        { provide: MemoryService, useValue: memoryService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    clearingService = moduleRef.get(ClearingService);
  });

  describe('prepare', () => {
    it('should refuse without a trigger id, since no dialog can open', async () => {
      const prepared = await clearingService.prepare({ ...REQUEST, triggerId: undefined });
      expect(prepared).toMatchObject({ error: { kind: 'no-trigger' }, success: false });
      expect(chatGateway.openDialogAsSystem).not.toHaveBeenCalled();
    });

    it('should refuse while a turn holds the channel, naming the agents (§8.5)', async () => {
      channelLockService.listHeld.mockReturnValue([
        { acquiredAt: new Date(), agentUsername: 'mira', channelId: 'channel-1' },
        { acquiredAt: new Date(), agentUsername: 'jo', channelId: 'channel-2' }
      ]);
      const prepared = await clearingService.prepare({ ...REQUEST, triggerId: 'trigger-1' });
      expect(prepared).toMatchObject({ error: { agentUsernames: ['mira'], kind: 'busy' }, success: false });
    });

    it('should open the dialog as the system bot with a signed state carrying the request', async () => {
      const prepared = await clearingService.prepare({ ...REQUEST, memories: true, triggerId: 'trigger-1' });
      expect(prepared.success).toBe(true);
      const request = chatGateway.openDialogAsSystem.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        callbackId: 'channel-1',
        elements: [],
        submitLabel: 'Clear',
        title: 'Clear this channel',
        triggerId: 'trigger-1',
        url: 'http://app.test/clearing/confirm'
      });
      expect(request?.introductionText).toContain('the memories written here');
      expect(JSON.parse(request?.state ?? '')).toMatchObject({
        byUsername: 'casey',
        channelId: 'channel-1',
        memories: true,
        signature: 'signed'
      });
      expect(callbackSigner.sign).toHaveBeenCalledWith(['clear', 'channel-1', 'casey', expect.any(String), 'memories']);
      expect(channelErasure.erase).not.toHaveBeenCalled();
    });

    // §7.5 — the system bot is never in a DM, so the one agent there opens it
    it('should open the dialog through the one agent present when the system bot is refused', async () => {
      chatGateway.openDialogAsSystem.mockResolvedValue(Result.err({ kind: 'api', message: 'not a member' }));
      rosterService.listAgentsIn.mockReturnValue([MIRA]);
      const prepared = await clearingService.prepare({ ...REQUEST, triggerId: 'trigger-1' });
      expect(prepared.success).toBe(true);
      expect(transport.openDialog).toHaveBeenCalledOnce();
    });
  });

  describe('confirm', () => {
    const STATE = { ...REQUEST, issuedAt: new Date().toISOString() };

    it('should refuse a confirmation older than its lifetime', async () => {
      const stale = { ...STATE, issuedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() };
      expect(await clearingService.confirm(stale)).toMatchObject({ error: { kind: 'expired' }, success: false });
      expect(channelLockService.acquire).not.toHaveBeenCalled();
    });

    it('should refuse when any lock is held, releasing the ones it took', async () => {
      channelLockService.acquire.mockImplementation((agentUsername: string) => {
        return agentUsername === 'jo' ? undefined : { release: () => released.push(agentUsername) };
      });
      const confirmed = await clearingService.confirm(STATE);
      expect(confirmed).toMatchObject({ error: { agentUsernames: ['jo'], kind: 'busy' }, success: false });
      expect(released).toStrictEqual(['mira']);
      expect(channelAnnouncer.announce).not.toHaveBeenCalled();
    });

    it('should change nothing when the notice cannot be posted', async () => {
      channelAnnouncer.announce.mockResolvedValue(undefined);
      expect(await clearingService.confirm(STATE)).toMatchObject({ error: { kind: 'unannounced' }, success: false });
      expect(channelErasure.erase).not.toHaveBeenCalled();
      expect(released).toStrictEqual(['mira', 'jo']);
    });

    it('should cut the store against the notice, then remove the posts and report the count', async () => {
      const before = new Date();
      expect(await clearingService.confirm(STATE)).toMatchObject({ success: true });
      expect(channelAnnouncer.announce).toHaveBeenCalledWith('channel-1', '🧹 casey is clearing this channel.');
      const erasure = channelErasure.erase.mock.calls[0]?.[0];
      expect(erasure).toMatchObject({
        boundary: { postsAfter: new Date(5000) },
        channelId: 'channel-1',
        notice: {
          attachments: [],
          authorKind: 'system',
          authorUsername: 'collegium',
          channelId: 'channel-1',
          createdAt: new Date(5000),
          id: 'notice-1',
          message: '🧹 casey is clearing this channel.'
        },
        selectMemories: false
      });
      expect(erasure?.boundary.eventsAfter.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(windowService.forgetAnchorsIn).toHaveBeenCalledWith('channel-1');
      expect(memoryService.deleteMany).not.toHaveBeenCalled();
      expect(released).toStrictEqual(['mira', 'jo']);
      await settle();
      const text = '🧹 casey cleared this channel: 3 post(s) removed; the agents start fresh here.';
      expect(chatGateway.erasePostsBefore).toHaveBeenCalledWith('channel-1', 'notice-1');
      expect(announced.edit).toHaveBeenCalledWith(text);
      expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledWith('notice-1', text);
    });

    it('should delete the memories the erasure named, per agent, and state a failure in the notice', async () => {
      channelErasure.erase.mockResolvedValue([
        { agentUsername: 'mira', memoryIds: ['m1', 'm2'] },
        { agentUsername: 'jo', memoryIds: ['m3'] }
      ]);
      memoryService.deleteMany.mockImplementation((agentUsername: string) => {
        return agentUsername === 'jo' ? Promise.reject(new Error('locked')) : Promise.resolve(2);
      });
      expect(await clearingService.confirm({ ...STATE, memories: true })).toMatchObject({ success: true });
      expect(channelErasure.erase.mock.calls[0]?.[0]).toMatchObject({ selectMemories: true });
      expect(memoryService.deleteMany).toHaveBeenCalledWith('mira', ['m1', 'm2']);
      await settle();
      expect(announced.edit).toHaveBeenCalledWith(
        "🧹 casey cleared this channel: 3 post(s) removed; the agents start fresh here. jo's memories could not be deleted; see /collegium memory jo."
      );
    });

    it('should say the clear failed before anything was removed when the transaction rejects', async () => {
      channelErasure.erase.mockRejectedValue(new Error('SQLITE_BUSY'));
      expect(await clearingService.confirm(STATE)).toMatchObject({ error: { kind: 'store-failed' }, success: false });
      expect(announced.edit).toHaveBeenCalledWith('🧹 Clear failed before anything was removed.');
      expect(chatGateway.erasePostsBefore).not.toHaveBeenCalled();
      expect(released).toStrictEqual(['mira', 'jo']);
    });

    it('should say how many posts remain when the plugin could not remove them all', async () => {
      chatGateway.erasePostsBefore.mockResolvedValue(Result.ok({ deleted: 300, failed: 12 }));
      await clearingService.confirm(STATE);
      await settle();
      expect(announced.edit).toHaveBeenCalledWith(
        '🧹 casey cleared this channel for the agents; 12 of 312 post(s) could not be removed. Run /collegium clear again.'
      );
    });

    it('should say the posts could not be removed when the plugin refuses', async () => {
      chatGateway.erasePostsBefore.mockResolvedValue(Result.err({ kind: 'api', message: 'HTTP 403' }));
      await clearingService.confirm(STATE);
      await settle();
      expect(announced.edit).toHaveBeenCalledWith(
        '🧹 casey cleared this channel for the agents; the posts could not be removed (HTTP 403). Run /collegium clear again.'
      );
    });
  });
});
