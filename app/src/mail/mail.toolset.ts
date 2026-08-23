import { defineToolset } from '@collegium/core/tools';
import type { ToolFailure, ToolResult, ToolTurnScope } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { $MailSettings } from './mail.schemas.ts';
import { MAIL_REGISTRY_TOKEN } from './mail.tokens.ts';
import { renderMailMessage, renderMailSummaries, renderOutboundPayload, toOutboundMail } from './mail.utils.ts';

import type { MailProvider } from './mail.provider.ts';
import type { MailRegistry } from './mail.registry.ts';
import type { MailFailure } from './mail.types.ts';

const MAIL_TIMEOUT_MS = 45_000;

const $Ref = z.string().min(1);

const $Count = z.number().int().min(1).max(25).default(10);

const $Outbound = {
  body: z.string().min(1).describe('The complete text to send, exactly as it will be presented for approval'),
  cc: z.array(z.email()).default([]).describe('Everyone to copy — every recipient is disclosed to the approver'),
  subject: z.string().min(1).describe('The subject line to send'),
  to: z.array(z.email()).min(1).describe('Everyone the message goes to')
};

function withProvider(
  context: { mail: MailRegistry; turn: ToolTurnScope },
  run: (provider: MailProvider) => Promise<ToolResult>
): Promise<ToolResult> | ToolResult {
  const provider = context.mail.providerFor(context.turn.agentUsername);
  if (!provider) {
    return Result.err({ kind: 'exception', message: 'no mailbox is configured for this agent' });
  }
  return run(provider);
}

/** a stale ref or refused query is the model's ordinary mistake; a dead provider ends the turn loudly */
function toReadResult<TValue>(result: Result<TValue, MailFailure.Read>, render: (value: TValue) => string): ToolResult {
  if (result.success) {
    return Result.ok({ text: render(result.value) });
  }
  const failure = match(result.error)
    .with({ kind: 'not-found' }, ({ ref }): ToolFailure => ({
      kind: 'invalid-arguments',
      message: `no message "${ref}" exists in the mailbox`
    }))
    .with({ kind: 'rejected' }, ({ message }): ToolFailure => ({ kind: 'invalid-arguments', message }))
    .with({ kind: 'auth' }, ({ message }): ToolFailure => ({ kind: 'exception', message }))
    .with({ kind: 'provider-unavailable' }, ({ message }): ToolFailure => ({ kind: 'exception', message }))
    .exhaustive();
  return Result.err(failure);
}

/**
 * §6.7 — a refusal is a fact the model may act on, but an unestablished outcome ends the turn
 * rather than reaching the model, since hearing "unresolved" invites the retry §6.6 forbids.
 */
function toSendResult(result: Result<void, MailFailure.Send>): ToolResult {
  if (result.success) {
    return Result.ok({ text: 'the message was sent' });
  }
  const failure = match(result.error)
    .with({ kind: 'send-unresolved' }, ({ message }): ToolFailure => ({ kind: 'unresolved', message }))
    .with({ kind: 'send-refused' }, ({ message }): ToolFailure => ({ kind: 'invalid-arguments', message }))
    .with({ kind: 'rejected' }, ({ message }): ToolFailure => ({ kind: 'invalid-arguments', message }))
    .with({ kind: 'not-found' }, ({ ref }): ToolFailure => ({
      kind: 'invalid-arguments',
      message: `no message "${ref}" exists in the mailbox`
    }))
    .with({ kind: 'auth' }, ({ message }): ToolFailure => ({ kind: 'exception', message }))
    .with({ kind: 'provider-unavailable' }, ({ message }): ToolFailure => ({ kind: 'exception', message }))
    .exhaustive();
  return Result.err(failure);
}

export const MAIL_TOOLSET = defineToolset({
  name: 'mail',
  services: { mail: MAIL_REGISTRY_TOKEN },
  settings: $MailSettings,
  tools: {
    conversation: {
      description:
        'Gather the whole conversation a message belongs to, oldest first. Returns summaries only — only open returns a body.',
      execute: (args, context) =>
        withProvider(context, async (provider) =>
          toReadResult(await provider.getConversation(args.ref), renderMailSummaries)
        ),
      parameters: z.object({
        ref: $Ref.describe('A message ref (shown as ⟨ref⟩); returns its whole conversation, oldest first')
      }),
      retryable: true,
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    list: {
      description: 'List the most recent messages in your mailbox. Returns summaries only — only open returns a body.',
      execute: (args, context) =>
        withProvider(context, async (provider) =>
          toReadResult(await provider.listRecent(args.count), renderMailSummaries)
        ),
      parameters: z.object({
        count: $Count.describe('How many of the most recent messages to list')
      }),
      retryable: true,
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => String(args.count)
    },
    open: {
      description:
        'Open one message in full — the only mail action that returns a body. Attachments are described by name, ' +
        'type, and size; their content is not retrievable.',
      execute: (args, context) =>
        withProvider(context, async (provider) => toReadResult(await provider.open(args.ref), renderMailMessage)),
      parameters: z.object({
        ref: $Ref.describe('The message ref to open in full')
      }),
      retryable: true,
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    reply: {
      /** §6.3 — the approval shows the full recipient list, the subject, and the entire body that will be sent */
      approval: (args) => ({
        body: renderOutboundPayload(`Reply to ⟨${args.ref}⟩`, args),
        presentation: 'collapse'
      }),
      description:
        'Reply to a message; it stays in that conversation for the recipient. Requires human approval, which ' +
        'discloses every recipient, the subject, and the entire body; drafting wording in conversation needs no ' +
        'approval at all.',
      execute: (args, context) =>
        withProvider(context, async (provider) => toSendResult(await provider.reply(args.ref, toOutboundMail(args)))),
      parameters: z.object({
        ...$Outbound,
        ref: $Ref.describe('The message being replied to; it stays in that conversation for the recipient'),
        to: z.array(z.email()).min(1).describe('Everyone the reply goes to')
      }),
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩ → ${args.to.join(', ')}`
    },
    search: {
      description:
        "Search your mailbox in the mail provider's own query grammar. Returns summaries only — only open returns a body.",
      execute: (args, context) =>
        withProvider(context, async (provider) =>
          toReadResult(await provider.search(args.query, args.count), renderMailSummaries)
        ),
      parameters: z.object({
        count: $Count.describe('How many matches to return'),
        query: z.string().min(1).describe("What to search for, in the mail provider's own query grammar")
      }),
      retryable: true,
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => `"${args.query}"`
    },
    send: {
      /** §6.3 — the approval shows the full recipient list, the subject, and the entire body that will be sent */
      approval: (args) => ({
        body: renderOutboundPayload('Send a new message', args),
        presentation: 'collapse'
      }),
      description:
        'Send a new message. Requires human approval, which discloses every recipient, the subject, and the entire ' +
        'body; drafting wording in conversation needs no approval at all.',
      execute: (args, context) =>
        withProvider(context, async (provider) => toSendResult(await provider.send(toOutboundMail(args)))),
      parameters: z.object($Outbound),
      timeoutMs: MAIL_TIMEOUT_MS,
      traceDetail: (args) => `"${args.subject}" → ${args.to.join(', ')}`
    }
  }
});
