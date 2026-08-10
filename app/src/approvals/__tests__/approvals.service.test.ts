import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { TurnEventInput } from '@/turns/turns.types.ts';

import { ApprovalsService } from '../approvals.service.ts';
import { PendingRegistry } from '../decisions/pending.registry.ts';

type ApprovalRow = {
  decidedByUsername?: string;
  id: string;
  payloadText: string;
  promptPostId: null | string;
  reason?: string;
  status: string;
  toolName: string;
  turnId: string;
};

const TURN = { agentUsername: 'mira', channelId: 'channel-1' };

describe('ApprovalsService', () => {
  let approvalsService: ApprovalsService;
  let events: TurnEventInput[];
  let loggingService: MockedInstance<LoggingService>;
  let rows: ApprovalRow[];
  let transport: MockedInstance<ChatTransport>;
  let updates: { postId: string; text: string }[];

  beforeEach(async () => {
    events = [];
    updates = [];
    const table = createModelTable<ApprovalRow>({
      defaults: (sequence) => ({ id: `approval-${sequence}`, promptPostId: null }),
      relations: { turn: () => TURN }
    });
    rows = table.rows;
    transport = MockFactory.createMock(ChatTransport);
    transport.describeUser.mockResolvedValue(Result.ok({ isBot: false, username: 'casey' }));
    transport.isChannelMember.mockResolvedValue(Result.ok(true));
    transport.openDialog.mockResolvedValue(Result.ok());
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(), postId: 'prompt-1' }));
    transport.maxPostSizeChars.mockResolvedValue(Result.ok(16_383));
    transport.updatePost.mockImplementation((postId, update) => {
      updates.push({ postId, text: update.text });
      return Promise.resolve(Result.ok());
    });
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockReturnValue('http://localhost:3000');
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    loggingService = MockFactory.createMock(LoggingService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        PendingRegistry,
        { provide: EnvService, useValue: envService },
        { provide: LoggingService, useValue: loggingService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: getModelToken('Approval'), useValue: table }
      ]
    }).compile();
    approvalsService = moduleRef.get(ApprovalsService);
  });

  const requestInput = () => ({
    agentUsername: 'mira',
    appendEvent: (event: TurnEventInput) => {
      events.push(event);
      return Promise.resolve();
    },
    args: { path: 'notes.md' },
    channelId: 'channel-1',
    payloadPresentation: 'collapse' as const,
    payloadText: 'write notes.md with 12 words',
    toolName: 'write_file',
    turnId: 'turn-1'
  });

  const request = async () => {
    const expected = rows.length + 1;
    const outcome = approvalsService.request(requestInput());
    await vi.waitFor(() => {
      expect(rows).toHaveLength(expected);
      expect(rows.at(-1)?.promptPostId).toBeTruthy();
    });
    return { outcome };
  };

  it('should block until resolved, then hand the decision back and record both trace events', async () => {
    const { outcome: pending } = await request();
    const resolved = await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'approved' });
    expect(resolved.success).toBe(true);
    const decision = await pending;
    expect(decision.value).toStrictEqual({ byUsername: 'casey', kind: 'approved' });
    expect(rows[0]).toMatchObject({ decidedByUsername: 'casey', status: 'approved' });
    expect(events.map((event) => event.kind)).toStrictEqual(['approval_requested', 'approval_decided']);
    expect(updates.at(-1)?.text).toContain('**Approved** by @casey');
  });

  it('should refuse a second decision on a resolved approval', async () => {
    const { outcome: pending } = await request();
    await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'denied' });
    await pending;
    const second = await approvalsService.resolve(rows[0]!.id, { byUsername: 'ana', kind: 'approved' });
    expect(second.error).toStrictEqual({ approvalId: rows[0]!.id, kind: 'already-resolved' });
    expect(rows[0]?.status).toBe('denied');
  });

  it('should invalidate every pending row, rewrite its prompt to a dead state, and unblock the turn', async () => {
    const { outcome: pending } = await request();
    expect(await approvalsService.invalidateAll('halt')).toBe(1);
    const decision = await pending;
    expect(decision.value).toStrictEqual({ kind: 'cancelled', reason: 'halt' });
    expect(rows[0]).toMatchObject({ reason: 'halt', status: 'invalidated' });
    expect(updates.at(-1)?.text).toContain('No longer awaiting a decision');
    expect(updates.at(-1)?.text).toContain('write notes.md with 12 words');
  });

  it('should cancel pending approvals in a channel as cancelled, never as denied (§7.5)', async () => {
    const { outcome: pending } = await request();
    expect(await approvalsService.cancelPendingIn('channel-1', 'stop')).toBe(1);
    const decision = await pending;
    expect(decision.value).toStrictEqual({ kind: 'cancelled', reason: 'stop' });
    expect(rows[0]).toMatchObject({ reason: 'stop', status: 'invalidated' });
    expect(events.map((event) => event.kind)).toStrictEqual(['approval_requested']);
  });

  it('should post the prompt with the full payload and the three decision buttons (§6.2, §3.7)', async () => {
    const { outcome: pending } = await request();
    const [message] = transport.send.mock.calls[0]!;
    expect(message.text).toContain('write notes.md with 12 words');
    expect(message.attachments?.[0]?.actions?.map((action) => action.name)).toStrictEqual([
      'Approve',
      'Deny',
      'Deny with reason'
    ]);
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse a decision from outside the channel (§3.7)', async () => {
    const { outcome: pending } = await request();
    transport.describeUser.mockResolvedValueOnce(Result.ok({ isBot: false, username: 'outsider' }));
    transport.isChannelMember.mockResolvedValueOnce(Result.ok(false));
    const refused = await approvalsService.decide({
      action: 'approve',
      approvalId: rows[0]!.id,
      byUserId: 'outsider-id',
      byUsername: 'a name the body chose'
    });
    expect(refused.error).toStrictEqual({ kind: 'approver-not-present', username: 'outsider' });
    expect(rows[0]?.status).toBe('pending');
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse a decision from a bot present in the channel (§3.7)', async () => {
    const { outcome: pending } = await request();
    transport.describeUser.mockResolvedValueOnce(Result.ok({ isBot: true, username: 'mira' }));
    const refused = await approvalsService.decide({
      action: 'approve',
      approvalId: rows[0]!.id,
      byUserId: 'mira-id',
      byUsername: 'mira'
    });
    expect(refused.error).toStrictEqual({ kind: 'approver-not-human', username: 'mira' });
    expect(rows[0]?.status).toBe('pending');
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should record the approver the user id resolves to, not the name in the request (§3.7)', async () => {
    const { outcome: pending } = await request();
    transport.describeUser.mockResolvedValueOnce(Result.ok({ isBot: false, username: 'casey' }));
    await approvalsService.decide({
      action: 'approve',
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'ceo-of-acme'
    });
    expect(rows[0]?.decidedByUsername).toBe('casey');
    await pending;
  });

  it('should open the reason dialog on deny-with-reason and resolve when it comes back (§5.4)', async () => {
    const { outcome: pending } = await request();
    const clicked = await approvalsService.decide({
      action: 'deny-with-reason',
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'casey',
      triggerId: 'trigger-1'
    });
    expect(clicked.success).toBe(true);
    expect(transport.openDialog).toHaveBeenCalledWith(
      expect.objectContaining({ callbackId: rows[0]!.id, triggerId: 'trigger-1' })
    );
    expect(rows[0]?.status).toBe('pending');
    await approvalsService.decideWithReason({
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'casey',
      reason: 'wrong file'
    });
    const decision = await pending;
    expect(decision.value).toStrictEqual({ byUsername: 'casey', kind: 'denied-with-reason', reason: 'wrong file' });
    expect(rows[0]).toMatchObject({ reason: 'wrong file', status: 'denied_with_reason' });
  });

  it('should resolve a bare denial from the button as denied, carrying no reason (§5.4)', async () => {
    const { outcome: pending } = await request();
    const denied = await approvalsService.decide({
      action: 'deny',
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'casey'
    });
    expect(denied.success).toBe(true);
    expect((await pending).value).toStrictEqual({ byUsername: 'casey', kind: 'denied' });
    expect(rows[0]).toMatchObject({ decidedByUsername: 'casey', status: 'denied' });
  });

  it('should refuse to open the reason dialog when the click carried no trigger id', async () => {
    const { outcome: pending } = await request();
    const refused = await approvalsService.decide({
      action: 'deny-with-reason',
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'casey'
    });
    expect(refused.error).toStrictEqual({ kind: 'dialog-undeliverable', message: 'the click carried no trigger id' });
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should report why the reason dialog could not be opened (§5.4)', async () => {
    const { outcome: pending } = await request();
    transport.openDialog.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'the trigger expired' }));
    const refused = await approvalsService.decide({
      action: 'deny-with-reason',
      approvalId: rows[0]!.id,
      byUserId: 'casey-id',
      byUsername: 'casey',
      triggerId: 'trigger-1'
    });
    expect(refused.error).toStrictEqual({ kind: 'dialog-undeliverable', message: 'the trigger expired' });
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse a decision from a user id chat cannot describe (§3.7)', async () => {
    const { outcome: pending } = await request();
    transport.describeUser.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'no such user' }));
    const refused = await approvalsService.decide({
      action: 'approve',
      approvalId: rows[0]!.id,
      byUserId: 'ghost-id',
      byUsername: 'ghost'
    });
    expect(refused.error).toStrictEqual({ kind: 'approver-not-present', username: 'ghost-id' });
    await approvalsService.cancelPendingIn('channel-1', 'stop');
    await pending;
  });

  it('should refuse a reason submission for an approval that no longer exists', async () => {
    const refused = await approvalsService.decideWithReason({
      approvalId: 'gone',
      byUserId: 'casey-id',
      byUsername: 'casey',
      reason: 'wrong file'
    });
    expect(refused.error).toStrictEqual({ approvalId: 'gone', kind: 'not-found' });
  });

  it('should refuse to resolve an approval id that has no row', async () => {
    const resolved = await approvalsService.resolve('gone', { kind: 'cancelled', reason: 'restart' });
    expect(resolved.error).toStrictEqual({ approvalId: 'gone', kind: 'not-found' });
  });

  it('should abandon the approval when its prompt cannot be posted, tracing nothing (§3.7)', async () => {
    transport.send.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'the channel is archived' }));
    const outcome = await approvalsService.request(requestInput());
    expect(outcome.error).toStrictEqual({ kind: 'prompt-undeliverable', message: 'the channel is archived' });
    expect(rows[0]?.status).toBe('invalidated');
    expect(events).toStrictEqual([]);
  });

  it('should rewrite a prompt whose approval was resolved while the post was still in flight (§3.7)', async () => {
    transport.send.mockImplementationOnce(async () => {
      await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'denied' });
      return Result.ok({ createdAt: new Date(), postId: 'prompt-1' });
    });
    const outcome = await approvalsService.request(requestInput());
    expect(outcome.value).toStrictEqual({ byUsername: 'casey', kind: 'denied' });
    expect(updates).toStrictEqual([{ postId: 'prompt-1', text: expect.stringContaining('**Denied** by @casey') }]);
  });

  it('should count only the approvals its own sweep claimed (§7.5)', async () => {
    const { outcome: first } = await request();
    const { outcome: second } = await request();
    transport.updatePost.mockImplementationOnce(async (postId, update) => {
      updates.push({ postId, text: update.text });
      await approvalsService.resolve(rows[1]!.id, { byUsername: 'casey', kind: 'approved' });
      return Result.ok();
    });
    expect(await approvalsService.cancelPendingIn('channel-1', 'stop')).toBe(1);
    expect((await first).value).toStrictEqual({ kind: 'cancelled', reason: 'stop' });
    expect((await second).value).toStrictEqual({ byUsername: 'casey', kind: 'approved' });
  });

  it('should log when the terminal rewrite of a prompt cannot be delivered', async () => {
    const { outcome: pending } = await request();
    transport.updatePost.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'the post was deleted' }));
    await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'approved' });
    await pending;
    expect(loggingService.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'failed to rewrite approval prompt prompt-1: the post was deleted' })
    );
  });

  describe('§6.2 verbatim refusal', () => {
    const verbatimInput = (payloadText: string) => ({
      ...requestInput(),
      payloadPresentation: 'verbatim' as const,
      payloadText,
      toolName: 'shell'
    });

    it('should refuse a verbatim command too long to fit a post, before posting anything', async () => {
      transport.maxPostSizeChars.mockResolvedValue(Result.ok(50));
      const outcome = await approvalsService.request(verbatimInput('x'.repeat(200)));
      expect(outcome.error).toMatchObject({ kind: 'payload-too-large' });
      expect(transport.send).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it('should post a verbatim command that fits and block for a decision as usual', async () => {
      transport.maxPostSizeChars.mockResolvedValue(Result.ok(10_000));
      const pending = approvalsService.request(verbatimInput('id -un'));
      await vi.waitFor(() => expect(rows).toHaveLength(1));
      expect(transport.send).toHaveBeenCalled();
      await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'approved' });
      expect((await pending).value).toMatchObject({ kind: 'approved' });
    });

    it('should not block a small command when the substrate limit cannot be read', async () => {
      transport.maxPostSizeChars.mockResolvedValue(Result.err({ kind: 'api', message: 'config unreachable' }));
      const pending = approvalsService.request(verbatimInput('id -un'));
      await vi.waitFor(() => expect(rows).toHaveLength(1));
      expect(loggingService.warn).toHaveBeenCalled();
      await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'approved' });
      await pending;
    });
  });
});
