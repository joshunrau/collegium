import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { PendingDecision } from '@/approvals/decisions/decisions.types.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ApprovalsHandler } from '../approvals.handler.ts';

const MIRA = buildAgentProfile();

const pending = (overrides: { channelId?: string } = {}): PendingDecision => ({
  actionName: 'mail::send',
  agentUsername: 'mira',
  channelId: 'channel-1',
  kind: 'approval',
  promptPostId: 'post-1',
  requestedAt: new Date('2026-09-17T11:00:00Z'),
  turnId: 'turn-1',
  ...overrides
});

describe('ApprovalsHandler', () => {
  let approvalsHandler: ApprovalsHandler;
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let transport: MockedInstance<ChatTransport>;

  const handle = (text = '') => {
    return approvalsHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });
  };

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.listPending.mockResolvedValue([]);
    transport = MockFactory.createMock(ChatTransport);
    transport.describeUser.mockResolvedValue(Result.ok({ isBot: false, username: 'casey' }));
    transport.isChannelMember.mockResolvedValue(Result.ok(true));
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.nameOf.mockReturnValue('Finance Ops');
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    approvalsHandler = moduleRef.get(ApprovalsHandler);
  });

  it('should answer the invoker alone with what is waiting in a channel they are in', async () => {
    pendingDecisionsService.listPending.mockResolvedValue([pending()]);
    const response = await handle();
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('· @mira · 🔐 `mail::send` ·');
    expect(response.text).toContain('Finance Ops');
  });

  it('should say nothing is waiting when nothing is pending anywhere', async () => {
    expect((await handle()).text).toBe('Nothing is waiting on a human in the channels you are in.');
  });

  it('should say the same when every pending approval sits in a channel the invoker is not in (§8.4)', async () => {
    pendingDecisionsService.listPending.mockResolvedValue([pending()]);
    transport.isChannelMember.mockResolvedValue(Result.ok(false));
    expect((await handle()).text).toBe('Nothing is waiting on a human in the channels you are in.');
  });

  it('should omit a row whose membership check the seam could not answer', async () => {
    pendingDecisionsService.listPending.mockResolvedValue([pending()]);
    transport.isChannelMember.mockResolvedValue(Result.err({ kind: 'api', message: 'unreachable' }));
    expect((await handle()).text).toBe('Nothing is waiting on a human in the channels you are in.');
  });

  it('should check membership once per distinct channel, not once per approval', async () => {
    pendingDecisionsService.listPending.mockResolvedValue([pending(), pending(), pending({ channelId: 'channel-2' })]);
    await handle();
    expect(transport.isChannelMember).toHaveBeenCalledTimes(2);
  });

  it('should narrow the listing to one agent when named, and refuse a name nothing declares', async () => {
    await handle(' mira ');
    expect(pendingDecisionsService.listPending).toHaveBeenCalledWith({ agentUsername: 'mira' });
    expect((await handle('nosuchagent')).text).toContain('No agent "nosuchagent"');
  });
});
