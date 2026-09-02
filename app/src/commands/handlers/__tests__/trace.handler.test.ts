import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConversationsService } from '@/conversations/conversations.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { TraceHandler } from '../trace.handler.ts';

const EVENTS = [
  {
    payload: {
      args: { path: 'a.md' },
      callId: 'c1',
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: { path: 'a.md' }, callId: 'c1', toolName: 'write_file' }]
    }
  },
  { payload: { callId: 'c1', kind: 'tool_result', output: 'wrote 5 bytes', toolName: 'write_file' } },
  { payload: { content: 'done', kind: 'assistant_message', toolCalls: [] } }
];

describe('TraceHandler', () => {
  let conversationsService: MockedInstance<ConversationsService>;
  let traceHandler: TraceHandler;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    conversationsService = MockFactory.createMock(ConversationsService);
    turnsService = MockFactory.createMock(TurnsService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TraceHandler,
        { provide: ConversationsService, useValue: conversationsService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    traceHandler = moduleRef.get(TraceHandler);
  });

  it('should render the full event sequence, ephemerally', async () => {
    conversationsService.findAuthoringTurn.mockResolvedValue({ channelId: 'channel-1', turnId: 'turn-1' });
    turnsService.listEvents.mockResolvedValue(EVENTS as never);
    const response = await traceHandler.handle({ channelId: 'channel-1', text: 'post-9', username: 'casey' });
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('1. called `write_file` with {"path":"a.md"}');
    expect(response.text).toContain('2. `write_file` → wrote 5 bytes');
    expect(response.text).toContain('3. assistant: done');
  });

  it('should refuse a bare /trace with the usage line', async () => {
    const response = await traceHandler.handle({ channelId: 'channel-1', text: '  ', username: 'casey' });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /collegium.trace {post-id}' });
    expect(conversationsService.findAuthoringTurn).not.toHaveBeenCalled();
  });

  it('should refuse a post whose turn ran in another channel', async () => {
    conversationsService.findAuthoringTurn.mockResolvedValue({ channelId: 'channel-9', turnId: 'turn-1' });
    const response = await traceHandler.handle({ channelId: 'channel-1', text: 'post-9', username: 'casey' });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'No turn authored post post-9 in this channel.'
    });
  });
});
