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

  it('should post the boot notice with the downtime window and abandoned work (§7.3)', async () => {
    await chatEmitter.notify({
      abandonedTurns: 2,
      agentUsernames: ['mira'],
      downSince: new Date('2026-07-26T12:00:00Z'),
      kind: 'online'
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      expect.stringContaining('Offline since July 26, 2026 at 12:00:00 PM UTC. 2 in-flight turn(s) were abandoned.')
    );
  });

  it('should post the boot notice without a downtime window or abandoned work', async () => {
    await chatEmitter.notify({
      abandonedTurns: 0,
      agentUsernames: ['mira', 'robin'],
      downSince: undefined,
      kind: 'online'
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🟢 **Online** — the orchestrator started with 2 agent(s): `mira`, `robin`.'
    );
  });

  it('should post the §4.5 correction as a fixed template in the offending channel', async () => {
    await chatEmitter.notify({ channelId: 'channel-1', kind: 'multi-mention-refusal' });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith('channel-1', '⚠️ Address one agent per message.');
    expect(chatGateway.postAsSystem).not.toHaveBeenCalled();
  });

  it('should post the §7.4 halt notice naming the turn ceiling', async () => {
    await chatEmitter.notify({ kind: 'halt', reason: { ceiling: 40, kind: 'turn-ceiling' } });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🛑 **Halted** — 40 turns started within one hour, the framework-wide ceiling. No agent will act until a human posts /collegium.resume.'
    );
  });

  it('should post the §7.4 halt notice naming the crowded respond-to-all channel', async () => {
    await chatEmitter.notify({
      kind: 'halt',
      reason: { agentUsernames: ['mira', 'robin'], channelId: 'channel-1', kind: 'topology-violation' }
    });
    expect(chatGateway.postAsSystem).toHaveBeenCalledWith(
      '🛑 **Halted** — respond-to-all channel channel-1 now holds 2 agents (mira, robin). No agent will act until a human posts /collegium.resume.'
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
