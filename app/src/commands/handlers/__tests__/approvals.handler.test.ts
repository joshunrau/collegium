import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { PendingApproval } from '@/approvals/approvals.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ApprovalsHandler } from '../approvals.handler.ts';

const MIRA = buildAgentProfile();

const pending = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  actionName: 'mail::send',
  agentUsername: 'mira',
  channelId: 'channel-1',
  promptPostId: 'post-1',
  requestedAt: new Date('2026-09-17T11:00:00Z'),
  ...overrides
});

describe('ApprovalsHandler', () => {
  let approvalsHandler: ApprovalsHandler;
  let approvalsService: MockedInstance<ApprovalsService>;
  let transport: MockedInstance<ChatTransport>;

  const handle = (text = '') => {
    return approvalsHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });
  };

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.listPending.mockResolvedValue([]);
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
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    approvalsHandler = moduleRef.get(ApprovalsHandler);
  });

  it('should answer the invoker alone with what is waiting in a channel they are in', async () => {
    approvalsService.listPending.mockResolvedValue([pending()]);
    const response = await handle();
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('· @mira · `mail::send` ·');
    expect(response.text).toContain('Finance Ops');
  });

  it('should say nothing is waiting when nothing is pending anywhere', async () => {
    expect((await handle()).text).toBe('Nothing is waiting on a human.');
  });

  it('should say so distinctly when every pending approval sits in a channel the invoker is not in', async () => {
    approvalsService.listPending.mockResolvedValue([pending()]);
    transport.isChannelMember.mockResolvedValue(Result.ok(false));
    expect((await handle()).text).toBe('Nothing is waiting on a human in the channels you are in.');
  });

  it('should omit a row whose membership check the seam could not answer', async () => {
    approvalsService.listPending.mockResolvedValue([pending()]);
    transport.isChannelMember.mockResolvedValue(Result.err({ kind: 'api', message: 'unreachable' }));
    expect((await handle()).text).toBe('Nothing is waiting on a human in the channels you are in.');
  });

  it('should check membership once per distinct channel, not once per approval', async () => {
    approvalsService.listPending.mockResolvedValue([pending(), pending(), pending({ channelId: 'channel-2' })]);
    await handle();
    expect(transport.isChannelMember).toHaveBeenCalledTimes(2);
  });

  it('should narrow the listing to one agent when named, and refuse a name nothing declares', async () => {
    await handle(' mira ');
    expect(approvalsService.listPending).toHaveBeenCalledWith('mira');
    expect((await handle('nosuchagent')).text).toContain('No agent "nosuchagent"');
  });
});
