import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ConfigService } from '@/config/config.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChatEmitter } from '../chat.emitter.ts';

describe('ChatEmitter', () => {
  let chatEmitter: ChatEmitter;
  let chatGateway: MockedInstance<ChatGateway>;

  beforeEach(async () => {
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.postAsSystem.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatEmitter,
        DateFormatter,
        { provide: ChatGateway, useValue: chatGateway },
        { provide: ConfigService, useValue: createConfigServiceMock() }
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
      requeuedTurns: 0
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
      requeuedTurns: 0
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
      requeuedTurns: 0
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🟢 **Online** — the orchestrator started with 2 agent(s): `mira`, `robin`.'
    );
  });

  it('should state how many abandoned turns went back into the queue, and only when any did (§7.3)', async () => {
    const online = { agentUsernames: ['mira'], downtime: undefined, kind: 'online' as const };
    await chatEmitter.notify({ ...online, abandonedTurns: 2, requeuedTurns: 1 });
    await chatEmitter.notify({ ...online, abandonedTurns: 2, requeuedTurns: 0 });
    expect(chatGateway.postAsSystem.mock.calls.map(([content]) => content)).toStrictEqual([
      '🟢 **Online** — the orchestrator started with 1 agent(s): `mira`. 2 in-flight turn(s) were abandoned. 1 that had not yet acted went back into the queue.',
      '🟢 **Online** — the orchestrator started with 1 agent(s): `mira`. 2 in-flight turn(s) were abandoned.'
    ]);
  });

  it('should post the §4.5 correction as a fixed template in the offending channel', async () => {
    await chatEmitter.notify({ channelId: 'channel-1', kind: 'multi-mention-refusal' });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⚠️ Address one agent per message. To name an agent without addressing it, put its handle in backticks: `@username`.'
    );
    expect(chatGateway.postAsSystem).not.toHaveBeenCalled();
  });

  it('should post the §7.4 chain-limit correction in the channel, naming the agent without a mention', async () => {
    await chatEmitter.notify({
      agentUsername: 'mira',
      channelId: 'channel-1',
      kind: 'chain-limit-refusal',
      limit: 200
    });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-1',
      '⛔ `mira` was not activated: this chain has reached its limit of 200 turns. A fresh post from a person starts a fresh chain.'
    );
    expect(chatGateway.postAsSystem).not.toHaveBeenCalled();
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
      '🛑 **Halted** — respond-to-all channel channel-1 now holds 2 agents (mira, robin). No agent will act until a human posts /collegium resume.'
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
