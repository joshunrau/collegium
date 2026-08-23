import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { MailProvider } from '../mail.provider.ts';
import { MailRegistry } from '../mail.registry.ts';
import { MAIL_TOOLSET } from '../mail.toolset.ts';

import type { MailSummary } from '../mail.types.ts';

const { conversation, list, open, reply, search, send } = MAIL_TOOLSET.tools;

const SUMMARY: MailSummary = {
  isRead: false,
  preview: 'Quarterly numbers attached',
  receivedAt: new Date('2026-08-01T10:00:00Z'),
  ref: 'm1',
  sender: { address: 'ana@example.org', name: 'Ana' },
  subject: 'Q3 report'
};

function buildContext() {
  const provider = MockFactory.createMock(MailProvider);
  const registry = MockFactory.createMock(MailRegistry);
  registry.providerFor.mockReturnValue(provider as never);
  const context = { mail: registry, turn: buildToolTurnScope() };
  return { context, provider };
}

describe('MAIL_TOOLSET', () => {
  it('fails with an exception when no mailbox is configured for the agent', async () => {
    const registry = MockFactory.createMock(MailRegistry);
    registry.providerFor.mockReturnValue(undefined);
    const result = await executeTool(list, { count: 10 }, { mail: registry, turn: buildToolTurnScope() });
    expect(result.error).toStrictEqual({ kind: 'exception', message: 'no mailbox is configured for this agent' });
  });

  it('lists recent messages as summaries', async () => {
    const { context, provider } = buildContext();
    provider.listRecent.mockResolvedValue(Result.ok([SUMMARY]));
    const result = await executeTool(list, { count: 5 }, context);
    expect(provider.listRecent).toHaveBeenCalledWith(5);
    expect(result.unwrap().text).toContain('⟨m1⟩');
    expect(result.unwrap().text).toContain('Q3 report');
  });

  it('returns a stale ref to the model as its own recoverable mistake', async () => {
    const { context, provider } = buildContext();
    provider.open.mockResolvedValue(Result.err({ kind: 'not-found', ref: 'm9' }));
    const result = await executeTool(open, { ref: 'm9' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no message "m9" exists in the mailbox'
    });
  });

  it('sends exactly the outbound fields, dropping the ref from the payload', async () => {
    const { context, provider } = buildContext();
    provider.reply.mockResolvedValue(Result.ok());
    const args = { body: 'On it.', cc: [], ref: 'm1', subject: 'Re: Q3', to: ['ana@example.org'] };
    const result = await executeTool(reply, args, context);
    expect(provider.reply).toHaveBeenCalledWith('m1', {
      body: 'On it.',
      cc: [],
      subject: 'Re: Q3',
      to: ['ana@example.org']
    });
    expect(result.unwrap().text).toBe('the message was sent');
  });

  it('reports an unestablished send as unresolved, never to the model', async () => {
    const { context, provider } = buildContext();
    provider.send.mockResolvedValue(Result.err({ kind: 'send-unresolved', message: 'connection died mid-send' }));
    const args = { body: 'Hi', cc: [], subject: 'Hello', to: ['ana@example.org'] };
    const result = await executeTool(send, args, context);
    expect(result.error).toStrictEqual({ kind: 'unresolved', message: 'connection died mid-send' });
  });

  it('gates reply and send with a payload disclosing every recipient, the subject, and the body (§6.3)', () => {
    const payload = send.approval?.({
      body: 'Full text.',
      cc: ['lee@example.org'],
      subject: 'Hello',
      to: ['ana@example.org']
    });
    expect(payload?.presentation).toBe('collapse');
    expect(payload?.body).toContain('To: ana@example.org');
    expect(payload?.body).toContain('Cc: lee@example.org');
    expect(payload?.body).toContain('Subject: Hello');
    expect(payload?.body).toContain('Full text.');
    expect('approval' in reply).toBe(true);
  });

  it('leaves every read ungated and retryable, and neither send nor reply (§7.2)', () => {
    for (const read of [conversation, list, open, search]) {
      expect(read.retryable).toBe(true);
      expect('approval' in read).toBe(false);
    }
    expect(reply.retryable).toBeUndefined();
    expect(send.retryable).toBeUndefined();
  });
});
