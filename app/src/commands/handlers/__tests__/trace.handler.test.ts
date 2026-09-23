import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { Turn } from '@/turns/turns.types.ts';

import { TraceHandler } from '../trace.handler.ts';

const TURN: Turn = {
  actionCount: 1,
  activationKind: 'addressed',
  agentUsername: 'mira',
  cachedPromptTokens: null,
  chainLength: 1,
  channelId: 'channel-1',
  completionTokens: null,
  contextAssembledAt: null,
  costUsd: null,
  depth: 0,
  drainedFromPostId: null,
  endedAt: new Date('2026-01-01T00:00:09.000Z'),
  id: 'turn-1',
  modelName: 'deepseek-v4-flash',
  promptTokens: null,
  reasoningTokens: null,
  rootPostId: 'post-1',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  status: 'completed',
  statusPostId: null,
  triggeringPostId: 'post-1',
  windowEstimatedTokens: null,
  windowOldestAt: null
};

const at = (seconds: number) => new Date(TURN.startedAt.getTime() + seconds * 1000);

const EVENTS = [
  {
    createdAt: at(2),
    payload: {
      args: { path: 'a.md' },
      callId: 'c1',
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: { path: 'a.md' }, callId: 'c1', toolName: 'write_file' }]
    }
  },
  { createdAt: at(3), payload: { callId: 'c1', kind: 'tool_result', output: 'wrote 5 bytes', toolName: 'write_file' } },
  { createdAt: at(8), payload: { content: 'done', kind: 'assistant_message', toolCalls: [] } }
];

describe('TraceHandler', () => {
  let conversationsService: MockedInstance<ConversationsService>;
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let traceHandler: TraceHandler;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    conversationsService = MockFactory.createMock(ConversationsService);
    turnsService = MockFactory.createMock(TurnsService);
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.listPending.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TraceHandler,
        DateFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    traceHandler = moduleRef.get(TraceHandler);
  });

  it('should render the full event sequence, ephemerally', async () => {
    conversationsService.findAuthoringTurn.mockResolvedValue(TURN);
    turnsService.listEvents.mockResolvedValue(EVENTS as never);
    const response = await traceHandler.handle({
      channelId: 'channel-1',
      text: 'post-9',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('Trace for turn turn-1 (mira on deepseek-v4-flash, completed, depth 0, chain 1):');
    expect(response.text).toContain('Started: January 1, 2026 at 12:00:00 AM UTC, by addressed');
    expect(response.text).toContain('1. [+2s] called `write_file` with {"path":"a.md"}');
    expect(response.text).toContain('2. [+3s] `write_file` → wrote 5 bytes');
    expect(response.text).toContain('3. [+8s] assistant: done');
    expect(pendingDecisionsService.listPending).toHaveBeenCalledWith({ turnId: 'turn-1' });
  });

  it('should refuse a bare /trace with the usage line', async () => {
    const response = await traceHandler.handle({
      channelId: 'channel-1',
      text: '  ',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /collegium trace {post-id}' });
    expect(conversationsService.findAuthoringTurn).not.toHaveBeenCalled();
  });

  it('should refuse a post whose turn ran in another channel', async () => {
    conversationsService.findAuthoringTurn.mockResolvedValue({ ...TURN, channelId: 'channel-9' });
    const response = await traceHandler.handle({
      channelId: 'channel-1',
      text: 'post-9',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'No turn authored post post-9 in this channel.'
    });
  });
});
