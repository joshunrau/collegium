import { z } from 'zod';

import { $ChannelHandle, $ResourcePath } from '../common.ts';

export type $MailEndpoint = z.infer<typeof $MailEndpoint>;
export const $MailEndpoint = z.strictObject({
  host: z.string().min(1).describe('Hostname of the endpoint'),
  password: z.string().min(1).describe('Password for this endpoint'),
  port: z.number().int().min(1).max(65535).describe('Port of the endpoint'),
  secure: z
    .boolean()
    .describe(
      'true for implicit TLS from the first byte (typically ports 993/465); false to connect plain and upgrade via STARTTLS where the server offers it (typically ports 143/587)'
    ),
  username: z.string().min(1).describe('Login username for this endpoint')
});

export type $ExchangeMailProvider = z.infer<typeof $ExchangeMailProvider>;
export const $ExchangeMailProvider = z.strictObject({
  address: z
    .email()
    .describe(
      'The mailbox address this agent acts as. Fixed here and never model-supplied: the from on everything the agent sends.'
    ),
  clientId: z
    .string()
    .min(1)
    .describe(
      "Client id of this agent's Entra app registration. One registration per agent mailbox — scoped by Exchange App RBAC — so the provider itself enforces that an agent reaches no mailbox but its own."
    ),
  clientSecret: z
    .string()
    .min(1)
    .describe('Client secret of the app registration. It expires on a tenant schedule, and mail stops when it does.'),
  kind: z.literal('exchange'),
  tenantId: z.string().min(1).describe('Entra tenant id the mailbox lives in')
});

export type $ImapMailProvider = z.infer<typeof $ImapMailProvider>;
export const $ImapMailProvider = z.strictObject({
  address: z
    .email()
    .describe(
      'The mailbox address this agent acts as. Fixed here and never model-supplied: the from on everything the agent sends.'
    ),
  imap: $MailEndpoint.describe('The IMAP endpoint mail is read from, with its credentials'),
  kind: z.literal('imap'),
  smtp: $MailEndpoint.describe('The SMTP endpoint mail is sent through, with its credentials')
});

export type $MailSettings = z.infer<typeof $MailSettings>;
export const $MailSettings = z
  .strictObject({
    announcementChannel: $ChannelHandle.describe(
      'Channel where arriving mail is announced, by handle. Must not be a DM, and the agent must be a member — both refused at boot rather than discovered at runtime.'
    ),
    pollIntervalMs: z
      .number()
      .int()
      .positive()
      .default(60_000)
      .describe(
        'How often the mailbox is polled for new arrivals, each poll advancing the durable cursor. Announcement latency is bounded by this plus idle-gating.'
      ),
    provider: z
      .discriminatedUnion('kind', [$ExchangeMailProvider, $ImapMailProvider])
      .describe(
        'Which kind of provider serves this mailbox, with its credentials: Exchange Online, or generic IMAP/SMTP.'
      ),
    template: $ResourcePath
      .optional()
      .describe(
        'An HTML file beneath `RESOURCES_ROOT` that every message this mailbox sends is wrapped in, holding `{BODY}` exactly once where the body goes. The body is rendered from markdown, with any raw HTML in it escaped. Absent, mail is sent as plain text.'
      )
  })
  .describe('The one mailbox an agent granted mail acts as. Granting mail without these is a boot refusal (§8).');

export type $BraveSearchProvider = z.infer<typeof $BraveSearchProvider>;
export const $BraveSearchProvider = z.strictObject({
  apiKey: z.string().min(1).describe('Brave Search API subscription token (https://api-dashboard.search.brave.com)'),
  kind: z.literal('brave')
});

export type $WebSearchSettings = z.infer<typeof $WebSearchSettings>;
export const $WebSearchSettings = z
  .strictObject({
    provider: z
      .discriminatedUnion('kind', [$BraveSearchProvider])
      .describe('Which search provider answers web::search, with its credentials')
  })
  .describe('The search provider behind web::search. Absent, the agent is not offered web::search.');

export type $WebSettings = z.infer<typeof $WebSettings>;
export const $WebSettings = z
  .strictObject({
    search: $WebSearchSettings.optional()
  })
  .describe('What the web toolset runs with. Every field is optional, so a bare grant works.');

export type $MemorySettings = z.infer<typeof $MemorySettings>;
export const $MemorySettings = z
  .strictObject({
    maxBodyChars: z
      .number()
      .int()
      .positive()
      .default(16_000)
      .describe(
        'Longest body one entry may hold. A longer write is refused rather than truncated, since a silently cut note is worse than a refused one. Bodies are read on demand, never rendered into every prompt, so the cost of a large one is paid only by the turn that reads it.'
      ),
    maxDescriptionChars: z
      .number()
      .int()
      .positive()
      .default(200)
      .describe(
        'Longest description one entry may hold. Descriptions enter the system prompt every turn, so this bounds that cost.'
      ),
    maxEntries: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe(
        'How many entries one agent may hold. Writing beyond it evicts the entry whose body was read longest ago, counting an entry never read from when it was written.'
      )
  })
  .describe("The bounds on one agent's memory (§3.6). Every field has a default, so a bare grant works.");
