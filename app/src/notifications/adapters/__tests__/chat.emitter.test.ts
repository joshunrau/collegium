import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChatEmitter } from '../chat.emitter.ts';

describe('ChatEmitter', () => {
  let chatEmitter: ChatEmitter;
  let chatGateway: MockedInstance<ChatGateway>;
  let rosterService: MockedInstance<RosterService>;
  let transport: MockedInstance<ChatTransport>;

  beforeEach(async () => {
    transport = MockFactory.createMock(ChatTransport);
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(0), postId: 'post-2' }));
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.postAsSystem.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    rosterService = MockFactory.createMock(RosterService);
    rosterService.isDirectMessage.mockReturnValue(false);
    rosterService.nameOf.mockReturnValue('Research');
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.displayNameOf.mockImplementation((username) => username.replace(/^./u, (first) => first.toUpperCase()));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatEmitter,
        DateFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    chatEmitter = moduleRef.get(ChatEmitter);
  });

  it('should name both ends of a downtime window a clean shutdown recorded (§7.3)', async () => {
    await chatEmitter.notify({
      abandonedTurns: 2,
      agentUsernames: ['mira'],
      downtime: {
        kind: 'clean',
        startedAt: new Date('2026-07-26T12:05:00Z'),
        stoppedAt: new Date('2026-07-26T12:00:00Z')
      },
      kind: 'online',
      requeuedTurns: 0,
      strandedUnits: []
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      expect.stringContaining(
        'Offline from July 26, 2026 at 12:00:00 PM UTC to July 26, 2026 at 12:05:00 PM UTC. 2 in-flight turn(s) were abandoned.'
      )
    );
  });

  it('should say since last known alive when a crash recorded no stop (§7.3)', async () => {
    await chatEmitter.notify({
      abandonedTurns: 0,
      agentUsernames: ['mira'],
      downtime: {
        kind: 'since-last-alive',
        lastAliveAt: new Date('2026-07-26T12:00:00Z'),
        startedAt: new Date('2026-07-26T12:05:00Z')
      },
      kind: 'online',
      requeuedTurns: 0,
      strandedUnits: []
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      expect.stringContaining('Offline since last known alive at July 26, 2026 at 12:00:00 PM UTC.')
    );
  });

  it('should post the boot notice without a downtime window or abandoned work', async () => {
    await chatEmitter.notify({
      abandonedTurns: 0,
      agentUsernames: ['mira', 'robin'],
      downtime: undefined,
      kind: 'online',
      requeuedTurns: 0,
      strandedUnits: []
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🟢 **Online** — the orchestrator started with 2 agent(s): Mira, Robin.'
    );
  });

  it('should state how many abandoned turns went back into the queue, and only when any did (§7.3)', async () => {
    const online = { agentUsernames: ['mira'], downtime: undefined, kind: 'online' as const, strandedUnits: [] };
    await chatEmitter.notify({ ...online, abandonedTurns: 2, requeuedTurns: 1 });
    await chatEmitter.notify({ ...online, abandonedTurns: 2, requeuedTurns: 0 });
    expect(chatGateway.postAsSystem.mock.calls.map(([content]) => content)).toStrictEqual([
      '🟢 **Online** — the orchestrator started with 1 agent(s): Mira. 2 in-flight turn(s) were abandoned. 1 that had not yet acted went back into the queue.',
      '🟢 **Online** — the orchestrator started with 1 agent(s): Mira. 2 in-flight turn(s) were abandoned.'
    ]);
  });

  it('should name each unit an abandoned turn left assigned, waking neither agent (§7.3)', async () => {
    await chatEmitter.notify({
      abandonedTurns: 1,
      agentUsernames: ['mira', 'owen'],
      downtime: undefined,
      kind: 'online',
      requeuedTurns: 0,
      strandedUnits: [
        { assigneeUsername: 'owen', channelId: 'channel-1', creatorUsername: 'mira', reference: 'ab12cd34' }
      ]
    });
    expect(chatGateway.postAsSystem.mock.calls[0]?.[0].split('\n')[1]).toBe(
      "- Unit `ab12cd34` in Research, from Mira to Owen, stays assigned: Owen's turn on it was abandoned."
    );
  });

  it('should post the §4.5 correction as a fixed template in the offending channel', async () => {
    await chatEmitter.notify({ channelId: 'channel-1', kind: 'multi-mention-refusal' });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⚠️ Address one agent per message. To name an agent without addressing it, write its name without the @.'
    );
    expect(chatGateway.postAsSystem).not.toHaveBeenCalled();
  });

  it('should post the §7.4 chain-limit correction in the channel, naming the agent by name, not a mention', async () => {
    await chatEmitter.notify({
      agentUsername: 'mira',
      channelId: 'channel-1',
      kind: 'chain-limit-refusal',
      limit: 200
    });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⛔ Mira was not activated: this chain has reached its limit of 200 turns. A fresh post from a person starts a fresh chain.'
    );
    expect(chatGateway.postAsSystem).not.toHaveBeenCalled();
  });

  it('should post the §7.6 long-turn notice in the channel, naming the agent by name, not a mention', async () => {
    await chatEmitter.notify({
      agentUsername: 'mira',
      channelId: 'channel-1',
      heldMs: 1_860_000,
      kind: 'long-turn',
      postsWaiting: false,
      tracedNothing: false
    });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⏳ Mira has been in one turn here for 31m without waiting on anyone. If its status post shows no progress, /collegium kill ends the turn; a turn still working needs nothing.'
    );
  });

  it('should say a long turn has called no tool yet, and that a post waits behind it (§7.6)', async () => {
    await chatEmitter.notify({
      agentUsername: 'mira',
      channelId: 'channel-1',
      heldMs: 1_860_000,
      kind: 'long-turn',
      postsWaiting: true,
      tracedNothing: true
    });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⏳ Mira has been in one turn here for 31m without waiting on anyone, and has called no tool yet: its status post was opened just now and will show what it does next. /collegium kill ends the turn; a turn still thinking needs nothing. A post addressing Mira is waiting behind this turn.'
    );
  });

  it('should post a §7.6 notice under the agent’s own account in a DM, without trying the system bot', async () => {
    rosterService.isDirectMessage.mockReturnValue(true);
    await chatEmitter.notify({ agentUsername: 'mira', channelId: 'dm-1', kind: 'standing-queue' });
    expect(chatGateway.postAsSystemIn).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith({ channelId: 'dm-1', text: expect.stringContaining('Mira has work waiting') });
  });

  it('should post a §7.6 notice the system bot is refused under the agent’s own account, as in a DM', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'not a member' }));
    await chatEmitter.notify({ agentUsername: 'mira', channelId: 'dm-1', kind: 'standing-queue' });
    expect(transport.send).toHaveBeenCalledWith({
      channelId: 'dm-1',
      text: '⏸️ Mira has work waiting here and no turn running. A post addressing Mira starts the turn that reads it; /collegium queue mira shows what waits.'
    });
  });

  it('should post the §7.4 halt notice naming the turn ceiling', async () => {
    await chatEmitter.notify({ kind: 'halt', reason: { ceiling: 40, kind: 'turn-ceiling' } });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🛑 **Halted** — 40 turns started within one hour, the framework-wide ceiling. No agent will act until a human posts /collegium resume.'
    );
  });

  it('should post the §7.4 halt notice naming the crowded respond-to-all channel', async () => {
    await chatEmitter.notify({
      kind: 'halt',
      reason: { agentUsernames: ['mira', 'robin'], channelId: 'channel-1', kind: 'topology-violation' }
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🛑 **Halted** — respond-to-all channel channel-1 now holds 2 agents (Mira, Robin). No agent will act until a human posts /collegium resume.'
    );
  });

  it('should distinguish a crash from a clean shutdown in the offline notice', async () => {
    await chatEmitter.notify({ kind: 'offline', reason: 'crash' });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🔴 **Offline** — the orchestrator crashed. Agents are not responding.'
    );

    await chatEmitter.notify({ kind: 'offline', reason: 'shutdown' });
    expect(chatGateway.postAsSystem).toHaveBeenLastCalledWith(
      '⚪ **Offline** — the orchestrator shut down. Agents are not responding.'
    );
  });

  it('should throw when mattermost refuses the notice post', async () => {
    chatGateway.postAsSystem.mockResolvedValue(Result.err({ kind: 'api', message: 'channel not found' }));
    await expect(chatEmitter.notify({ kind: 'offline', reason: 'crash' })).rejects.toThrow(
      'mattermost refused the notice post: channel not found'
    );
  });
});
