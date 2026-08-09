import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { MAIL_TOOL_NAME } from '@/mail/mail.constants.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import type { MailFailure } from '@/mail/mail.types.ts';
import { renderMailMessage, renderMailSummaries } from '@/mail/mail.utils.ts';

type $MailArgs = z.infer<typeof $MailArgs>;
const $MailArgs = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['list']),
    count: z.number().int().min(1).max(25).default(10).describe('How many of the most recent messages to list')
  }),
  z.object({
    action: z.enum(['search']),
    count: z.number().int().min(1).max(25).default(10).describe('How many matches to return'),
    query: z.string().min(1).describe("What to search for, in the mail provider's own query grammar")
  }),
  z.object({
    action: z.enum(['conversation']),
    ref: z.string().min(1).describe('A message ref (shown as ⟨ref⟩); returns its whole conversation, oldest first')
  }),
  z.object({
    action: z.enum(['open']),
    ref: z.string().min(1).describe('The message ref to open in full')
  }),
  z.object({
    action: z.enum(['reply']),
    body: z.string().min(1).describe('The complete text to send, exactly as it will be presented for approval'),
    cc: z.array(z.email()).default([]).describe('Everyone to copy — every recipient is disclosed to the approver'),
    ref: z.string().min(1).describe('The message being replied to; it stays in that conversation for the recipient'),
    subject: z.string().min(1).describe('The subject line to send'),
    to: z.array(z.email()).min(1).describe('Everyone the reply goes to')
  }),
  z.object({
    action: z.enum(['send']),
    body: z.string().min(1).describe('The complete text to send, exactly as it will be presented for approval'),
    cc: z.array(z.email()).default([]).describe('Everyone to copy — every recipient is disclosed to the approver'),
    subject: z.string().min(1).describe('The subject line to send'),
    to: z.array(z.email()).min(1).describe('Everyone the message goes to')
  })
]);

type OutboundArgs = Extract<$MailArgs, { action: 'reply' | 'send' }>;

/** exactly what leaves, with the discriminator and ref dropped — the provider owns threading */
function toOutboundMail(args: OutboundArgs): { body: string; cc: string[]; subject: string; to: string[] } {
  return { body: args.body, cc: args.cc, subject: args.subject, to: args.to };
}

/** what leaves, in full: every recipient the approver must see, the subject, and the whole body (§6.3) */
function renderOutboundPayload(intent: string, args: OutboundArgs): string {
  const mail = toOutboundMail(args);
  return [
    `${intent}:`,
    '',
    `To: ${mail.to.join(', ')}`,
    ...(mail.cc.length === 0 ? [] : [`Cc: ${mail.cc.join(', ')}`]),
    `Subject: ${mail.subject}`,
    '',
    mail.body
  ].join('\n');
}

@Injectable()
export class MailTool extends Tool({
  description:
    'Work your mailbox: list recent messages, search, gather the conversation a message belongs to, open one message ' +
    'in full, reply to a message, or send a new one. Only open returns a body. Attachments are described by name, ' +
    'type, and size — their content is not retrievable. Replying and sending require human approval, which discloses ' +
    'every recipient, the subject, and the entire body; drafting wording in conversation needs no approval at all.',
  name: MAIL_TOOL_NAME,
  parameters: $MailArgs,
  timeoutMs: 45_000,
  variant: 'dynamic'
}) {
  constructor(private readonly mailRegistry: MailRegistry) {
    super();
  }

  async execute(args: $MailArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const provider = this.mailRegistry.providerFor(turn.agentUsername);
    if (!provider) {
      return Result.err({ kind: 'exception', message: 'no mailbox is configured for this agent' });
    }
    return match(args)
      .with({ action: 'list' }, async ({ count }) =>
        this.toToolResult(await provider.listRecent(count), renderMailSummaries)
      )
      .with({ action: 'search' }, async ({ count, query }) =>
        this.toToolResult(await provider.search(query, count), renderMailSummaries)
      )
      .with({ action: 'conversation' }, async ({ ref }) =>
        this.toToolResult(await provider.getConversation(ref), renderMailSummaries)
      )
      .with({ action: 'open' }, async ({ ref }) => this.toToolResult(await provider.open(ref), renderMailMessage))
      .with({ action: 'reply' }, async (args) =>
        this.toSendResult(await provider.reply(args.ref, toOutboundMail(args)))
      )
      .with({ action: 'send' }, async (args) => this.toSendResult(await provider.send(toOutboundMail(args))))
      .exhaustive();
  }

  /** §6.3 — the approval shows the full recipient list, the subject, and the entire body that will be sent */
  getApprovalRequirements(args: $MailArgs): Tool.ApprovalRequirements {
    return match(args)
      .with({ action: 'reply' }, (reply): Tool.ApprovalRequirements => ({
        kind: 'gated',
        payload: { body: renderOutboundPayload(`Reply to ⟨${reply.ref}⟩`, reply), presentation: 'collapse' }
      }))
      .with({ action: 'send' }, (send): Tool.ApprovalRequirements => ({
        kind: 'gated',
        payload: { body: renderOutboundPayload('Send a new message', send), presentation: 'collapse' }
      }))
      .otherwise((): Tool.ApprovalRequirements => ({ kind: 'ungated' }));
  }

  /** §7.2 — reads may be told they timed out; a send that may have left must never be repeated */
  isRetryable(args: $MailArgs): boolean {
    return args.action !== 'reply' && args.action !== 'send';
  }

  renderTraceDetail(args: $MailArgs): string {
    return match(args)
      .with({ action: 'list' }, ({ count }) => `list ${count}`)
      .with({ action: 'search' }, ({ query }) => `search "${query}"`)
      .with({ action: 'conversation' }, ({ ref }) => `conversation ⟨${ref}⟩`)
      .with({ action: 'open' }, ({ ref }) => `open ⟨${ref}⟩`)
      .with({ action: 'reply' }, ({ ref, to }) => `reply to ⟨${ref}⟩ → ${to.join(', ')}`)
      .with({ action: 'send' }, ({ subject, to }) => `send "${subject}" → ${to.join(', ')}`)
      .exhaustive();
  }

  /**
   * §6.7 — a refusal is a fact the model may act on, but an unestablished outcome ends the turn
   * rather than reaching the model, since hearing "unresolved" invites the retry §6.6 forbids.
   */
  private toSendResult(result: Result<void, MailFailure.Send>): Result<Tool.Output, Tool.Failure> {
    if (result.success) {
      return Result.ok({ text: 'the message was sent' });
    }
    const failure = match(result.error)
      .with({ kind: 'send-unresolved' }, ({ message }): Tool.Failure => ({ kind: 'unresolved', message }))
      .with({ kind: 'send-refused' }, ({ message }): Tool.Failure => ({ kind: 'invalid-arguments', message }))
      .with({ kind: 'rejected' }, ({ message }): Tool.Failure => ({ kind: 'invalid-arguments', message }))
      .with({ kind: 'not-found' }, ({ ref }): Tool.Failure => ({
        kind: 'invalid-arguments',
        message: `no message "${ref}" exists in the mailbox`
      }))
      .with({ kind: 'auth' }, ({ message }): Tool.Failure => ({ kind: 'exception', message }))
      .with({ kind: 'provider-unavailable' }, ({ message }): Tool.Failure => ({ kind: 'exception', message }))
      .exhaustive();
    return Result.err(failure);
  }

  /** a stale ref or refused query is the model's ordinary mistake; a dead provider ends the turn loudly */
  private toToolResult<TValue>(
    result: Result<TValue, MailFailure.Read>,
    render: (value: TValue) => string
  ): Result<Tool.Output, Tool.Failure> {
    if (result.success) {
      return Result.ok({ text: render(result.value) });
    }
    const failure = match(result.error)
      .with({ kind: 'not-found' }, ({ ref }): Tool.Failure => ({
        kind: 'invalid-arguments',
        message: `no message "${ref}" exists in the mailbox`
      }))
      .with({ kind: 'rejected' }, ({ message }): Tool.Failure => ({ kind: 'invalid-arguments', message }))
      .with({ kind: 'auth' }, ({ message }): Tool.Failure => ({ kind: 'exception', message }))
      .with({ kind: 'provider-unavailable' }, ({ message }): Tool.Failure => ({ kind: 'exception', message }))
      .exhaustive();
    return Result.err(failure);
  }
}
