import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailRegistry } from '@/mail/mail.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { MailTool } from '../mail.tool.ts';

const SUMMARY = {
  isRead: false,
  preview: 'Please pay invoice 42',
  receivedAt: new Date('2026-07-30T12:00:00Z'),
  ref: 'msg-1',
  sender: { address: 'billing@acme.com', name: 'Acme Billing' },
  subject: 'Invoice overdue'
};

const MESSAGE = {
  attachments: [{ name: 'invoice.pdf', size: 12_345, type: 'application/pdf' }],
  body: 'Please pay invoice 42.',
  cc: [],
  isRead: false,
  receivedAt: new Date('2026-07-30T12:00:00Z'),
  ref: 'msg-1',
  replyTo: [],
  sender: { address: 'billing@acme.com', name: 'Acme Billing' },
  subject: 'Invoice overdue',
  to: [{ address: 'tess.rivera@example.org' }]
};

const turn = { agentUsername: 'tess' } as Tool.TurnScope;

describe('MailTool', () => {
  const provider = {
    getConversation: vi.fn(),
    listRecent: vi.fn(),
    open: vi.fn(),
    reply: vi.fn(),
    search: vi.fn(),
    send: vi.fn()
  };
  let tool: MailTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.providerFor.mockImplementation((agentUsername) =>
      agentUsername === 'tess' ? (provider as never) : undefined
    );
    const moduleRef = await Test.createTestingModule({
      providers: [MailTool, { provide: MailRegistry, useValue: mailRegistry }]
    }).compile();
    tool = moduleRef.get(MailTool);
  });

  it('should list summaries with ref, sender, subject, and preview — never a body', async () => {
    provider.listRecent.mockResolvedValue(Result.ok([SUMMARY]));
    const result = await tool.execute({ action: 'list', count: 10 }, turn);
    expect(result.value?.text).toContain('⟨msg-1⟩ Acme Billing <billing@acme.com> — Invoice overdue');
    expect(result.value?.text).toContain('> Please pay invoice 42');
    expect(provider.listRecent).toHaveBeenCalledWith(10);
  });

  it('should open a message in full, naming attachments as not retrievable', async () => {
    provider.open.mockResolvedValue(Result.ok(MESSAGE));
    const result = await tool.execute({ action: 'open', ref: 'msg-1' }, turn);
    expect(result.value?.text).toContain('Please pay invoice 42.');
    expect(result.value?.text).toContain('Attachments (content is not retrievable):');
    expect(result.value?.text).toContain('- invoice.pdf (application/pdf, 12345 bytes)');
  });

  it('should feed a stale ref back as an ordinary mistake', async () => {
    provider.open.mockResolvedValue(Result.err({ kind: 'not-found', ref: 'msg-gone' }));
    const result = await tool.execute({ action: 'open', ref: 'msg-gone' }, turn);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no message "msg-gone" exists in the mailbox'
    });
  });

  it('should end loudly when the provider is unreachable', async () => {
    provider.search.mockResolvedValue(Result.err({ kind: 'provider-unavailable', message: 'Exchange is down' }));
    const result = await tool.execute({ action: 'search', count: 10, query: 'invoices' }, turn);
    expect(result.error).toMatchObject({ kind: 'exception' });
  });

  it('should refuse an agent with no mailbox as a programmer error', async () => {
    const result = await tool.execute({ action: 'list', count: 10 }, { agentUsername: 'mira' } as Tool.TurnScope);
    expect(result.error).toMatchObject({ kind: 'exception' });
  });

  it('should leave every read action ungated and retryable', () => {
    expect(tool.variant).toBe('dynamic');
    expect(tool.getApprovalRequirements({ action: 'list', count: 10 })).toStrictEqual({ kind: 'ungated' });
    expect(tool.getApprovalRequirements({ action: 'open', ref: 'msg-1' })).toStrictEqual({ kind: 'ungated' });
    expect(tool.isRetryable({ action: 'open', ref: 'msg-1' })).toBe(true);
    expect(tool.renderTraceDetail({ action: 'search', count: 10, query: 'invoices' })).toBe('search "invoices"');
    expect(tool.renderTraceDetail({ action: 'open', ref: 'msg-1' })).toBe('open ⟨msg-1⟩');
  });

  describe('sending (§6.3, §6.7)', () => {
    const REPLY = {
      action: 'reply' as const,
      body: 'The invoice is scheduled for Friday.',
      cc: ['ops@example.org'],
      ref: 'msg-1',
      subject: 'Re: Invoice overdue',
      to: ['billing@acme.com']
    };

    it('should gate a reply, disclosing every recipient, the subject, and the whole body', () => {
      const requirements = tool.getApprovalRequirements(REPLY);
      expect(requirements.kind).toBe('gated');
      const body = requirements.kind === 'gated' ? requirements.payload.body : '';
      expect(body).toContain('To: billing@acme.com');
      expect(body).toContain('Cc: ops@example.org');
      expect(body).toContain('Subject: Re: Invoice overdue');
      expect(body).toContain('The invoice is scheduled for Friday.');
    });

    it('should never retry a send action', () => {
      expect(tool.isRetryable(REPLY)).toBe(false);
      expect(tool.isRetryable({ action: 'send', body: 'hi', cc: [], subject: 'Hello', to: ['a@acme.com'] })).toBe(
        false
      );
    });

    it('should send exactly the approved content, with threading left to the provider', async () => {
      provider.reply.mockResolvedValue(Result.ok());
      const result = await tool.execute(REPLY, turn);
      expect(result.value?.text).toBe('the message was sent');
      expect(provider.reply).toHaveBeenCalledWith('msg-1', {
        body: 'The invoice is scheduled for Friday.',
        cc: ['ops@example.org'],
        subject: 'Re: Invoice overdue',
        to: ['billing@acme.com']
      });
    });

    it('should feed a definitive refusal back to the model', async () => {
      provider.send.mockResolvedValue(Result.err({ kind: 'send-refused', message: '550 5.7.708 denied' }));
      const result = await tool.execute(
        { action: 'send', body: 'hi', cc: [], subject: 'Hello', to: ['a@acme.com'] },
        turn
      );
      expect(result.error).toMatchObject({ kind: 'invalid-arguments' });
    });

    it('should end the turn on an unresolved send rather than telling the model', async () => {
      provider.send.mockResolvedValue(Result.err({ kind: 'send-unresolved', message: 'the connection died' }));
      const result = await tool.execute(
        { action: 'send', body: 'hi', cc: [], subject: 'Hello', to: ['a@acme.com'] },
        turn
      );
      expect(result.error).toMatchObject({ kind: 'unresolved' });
    });
  });
});
