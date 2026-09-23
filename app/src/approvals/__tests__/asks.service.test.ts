import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { TurnEventInput } from '@/turns/turns.types.ts';

import { AsksService } from '../asks.service.ts';
import { AskPendingRegistry } from '../decisions/ask-pending.registry.ts';

type AskRow = {
  answeredByUsername?: string;
  answerText?: string;
  createdAt: Date;
  id: string;
  options: null | string[];
  promptPostId: null | string;
  question: string;
  status: string;
  turnId: string;
};

const TURN = { agentUsername: 'mira', channelId: 'channel-1' };

describe('AsksService', () => {
  let asksService: AsksService;
  let conversationsService: MockedInstance<ConversationsService>;
  let events: TurnEventInput[];
  let rows: AskRow[];
  let transport: MockedInstance<ChatTransport>;
  let updates: { postId: string; text: string }[];

  beforeEach(async () => {
    events = [];
    updates = [];
    const table = createModelTable<AskRow>({
      defaults: (sequence) => ({
        createdAt: new Date(sequence),
        id: `ask-${sequence}`,
        options: null,
        promptPostId: null
      }),
      relations: { turn: () => TURN }
    });
    rows = table.rows;
    transport = MockFactory.createMock(ChatTransport);
    transport.describeUser.mockResolvedValue(Result.ok({ isBot: false, username: 'casey' }));
    transport.isChannelMember.mockResolvedValue(Result.ok(true));
    transport.openDialog.mockResolvedValue(Result.ok());
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(), postId: 'prompt-1' }));
    transport.updatePost.mockImplementation((postId, update) => {
      updates.push({ postId, text: update.text });
      return Promise.resolve(Result.ok());
    });
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.record.mockResolvedValue(true);
    conversationsService.updateAuthoredMessage.mockResolvedValue(undefined);
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockImplementation((key) => (key === 'CALLBACK_TOKEN' ? 'r'.repeat(32) : 'http://localhost:3000'));
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    const multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.stripAgentMentions.mockImplementation((text: string) => text.replaceAll('@owen', 'owen'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AsksService,
        AskPendingRegistry,
        CallbackSigner,
        { provide: ConversationsService, useValue: conversationsService },
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: EnvService, useValue: envService },
        { provide: LoggingService, useValue: MockFactory.createMock(LoggingService) },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: getModelToken('Ask'), useValue: table }
      ]
    }).compile();
    asksService = moduleRef.get(AsksService);
  });

  const request = async (overrides: { question?: string } = {}) => {
    const outcome = asksService.request({
      agentUsername: 'mira',
      appendEvent: (event: TurnEventInput) => {
        events.push(event);
        return Promise.resolve();
      },
      callId: 'call-1',
      channelId: 'channel-1',
      contextText: 'Action 7 of 25 · raised by a trigger',
      options: ['Heathrow', 'Gatwick'],
      question: 'Which airport?',
      toolName: 'human',
      toolNamespace: 'ask',
      turnId: 'turn-1',
      ...overrides
    });
    await vi.waitFor(() => {
      expect(rows.at(-1)?.promptPostId).toBeTruthy();
    });
    return { outcome };
  };

  it('should block until answered, then hand the answer back and record both trace events (§3.7a)', async () => {
    const { outcome: pending } = await request();
    const answered = await asksService.answer({ answerText: 'Gatwick', askId: rows[0]!.id, byUserId: 'casey-id' });
    expect(answered.success).toBe(true);
    expect((await pending).value).toStrictEqual({ answerText: 'Gatwick', byUsername: 'casey', kind: 'answered' });
    expect(rows[0]).toMatchObject({ answeredByUsername: 'casey', answerText: 'Gatwick', status: 'answered' });
    expect(events.map((event) => event.kind)).toStrictEqual(['ask_requested', 'ask_answered']);
    expect(updates.at(-1)?.text).toContain('**Answered** by @casey');
  });

  it('should record the question as a prompt of the turn’s own and keep the stored copy current once answered (§3.7a)', async () => {
    const { outcome: pending } = await request();
    expect(conversationsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'agent', authorUsername: 'mira', id: 'prompt-1' }),
      { kind: 'prompt', turnId: 'turn-1' }
    );
    await asksService.answer({ answerText: 'Gatwick', askId: rows[0]!.id, byUserId: 'casey-id' });
    await pending;
    expect(conversationsService.updateAuthoredMessage).toHaveBeenCalledWith(
      'prompt-1',
      expect.stringContaining('**Answered** by @casey')
    );
  });

  it('should strip a peer mention from the question before it posts under the agent’s account (§4.5)', async () => {
    const { outcome } = await request({ question: 'Should @owen take this?' });
    const [message] = transport.send.mock.calls[0]!;
    expect(message.text).toContain('Should owen take this?');
    expect(rows[0]).toMatchObject({ question: 'Should owen take this?' });
    await asksService.cancelPendingIn('channel-1', 'stop');
    await outcome;
  });

  it('should post the question with a button per offered answer and one for free text (§3.7a)', async () => {
    const { outcome: pending } = await request();
    const [message] = transport.send.mock.calls[0]!;
    expect(message.text).toContain('Which airport?');
    expect(message.attachments?.[0]?.actions?.map((action) => action.name)).toStrictEqual([
      'Heathrow',
      'Gatwick',
      'Answer…'
    ]);
    await asksService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse an answer from outside the channel (§3.7)', async () => {
    const { outcome: pending } = await request();
    transport.describeUser.mockResolvedValueOnce(Result.ok({ isBot: false, username: 'outsider' }));
    transport.isChannelMember.mockResolvedValueOnce(Result.ok(false));
    const refused = await asksService.answer({ answerText: 'Gatwick', askId: rows[0]!.id, byUserId: 'outsider-id' });
    expect(refused.error).toStrictEqual({ kind: 'approver-not-present', username: 'outsider' });
    expect(rows[0]?.status).toBe('pending');
    await asksService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse a second answer on a resolved question', async () => {
    const { outcome: pending } = await request();
    await asksService.answer({ answerText: 'Gatwick', askId: rows[0]!.id, byUserId: 'casey-id' });
    await pending;
    const second = await asksService.answer({ answerText: 'Heathrow', askId: rows[0]!.id, byUserId: 'casey-id' });
    expect(second.error).toStrictEqual({ kind: 'already-resolved', pendingId: rows[0]!.id });
  });

  it('should cancel a pending question and unblock the turn without an answer (§7.5)', async () => {
    const { outcome: pending } = await request();
    expect(await asksService.invalidateAll('halt')).toBe(1);
    expect((await pending).value).toStrictEqual({ kind: 'cancelled', reason: 'halt' });
    expect(rows[0]?.status).toBe('invalidated');
    expect(updates.at(-1)?.text).toContain('No longer awaiting an answer');
    expect(events.map((event) => event.kind)).toStrictEqual(['ask_requested']);
  });

  it('should name the resolved answerer in the free-text dialog’s state, never the request’s own name (§6.4)', async () => {
    const { outcome: pending } = await request();
    const opened = await asksService.openAnswerDialog({
      askId: rows[0]!.id,
      byUserId: 'casey-id',
      triggerId: 'trigger-1'
    });
    expect(opened.success).toBe(true);
    const dialog = transport.openDialog.mock.calls[0]![0];
    expect(JSON.parse(dialog.state ?? '')).toStrictEqual({ byUsername: 'casey', signature: expect.any(String) });
    expect(rows[0]?.status).toBe('pending');
    await asksService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should list a question still waiting, with its words, and none once answered (§8.4)', async () => {
    const { outcome: pending } = await request();
    expect(await asksService.listPending({ channelId: 'channel-1' })).toStrictEqual([
      {
        actionName: 'ask::human',
        agentUsername: 'mira',
        channelId: 'channel-1',
        kind: 'ask',
        promptPostId: 'prompt-1',
        question: 'Which airport?',
        requestedAt: rows[0]!.createdAt,
        turnId: 'turn-1'
      }
    ]);
    await asksService.answer({ answerText: 'Gatwick', askId: rows[0]!.id, byUserId: 'casey-id' });
    await pending;
    expect(await asksService.listPending({})).toStrictEqual([]);
  });
});
