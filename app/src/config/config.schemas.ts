import { $QualifiedSkillName, $QualifiedToolName, PLUGIN_NAME_PATTERN } from '@collegium/core/plugins';
import { isUnique } from '@collegium/core/utils';
import { z } from 'zod';

import { DEEPSEEK_MODELS, OPENROUTER_MODELS } from '@/core/core.constants.ts';
import { $LogLevel } from '@/core/core.schemas.ts';
import { MAIL_TOOL_NAME } from '@/mail/mail.constants.ts';
import { SKILL_NAMES } from '@/skills/skills.constants.ts';
import { TOOL_NAMES } from '@/tools/tools.constants.ts';

import { CONFIG_DEFAULTS } from './config.constants.ts';

// After any change here: run `pnpm build:schema` (a test fails while the checked-in
// config.schema.json is stale) and update config.json to match. The e2e mirrors
// (`buildCollegiumConfig`, `Scenario`) are typed from `Config` and stop compiling on their own.

export type $ModelRef = z.infer<typeof $ModelRef>;
export const $ModelRef = z.discriminatedUnion('provider', [
  z.object({ name: z.enum(DEEPSEEK_MODELS), provider: z.literal('deepseek') }),
  z.object({ name: z.enum(OPENROUTER_MODELS), provider: z.literal('openrouter') })
]);

/**
 * A channel's name in its URL, not its display name and not its id — the one handle for a channel
 * an operator can state before the channel exists. Mattermost's own rule for the field.
 */
export type $ChannelHandle = z.infer<typeof $ChannelHandle>;
export const $ChannelHandle = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(64);

/** a Mattermost account name: the slug an agent is addressed by, and its bot account's own handle */
export type $Username = z.infer<typeof $Username>;
export const $Username = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(22);

export type $TriggerMode = z.infer<typeof $TriggerMode>;
export const $TriggerMode = z.enum(['mention-required', 'respond-to-all']);

export type $ChannelDefinition = z.infer<typeof $ChannelDefinition>;
export const $ChannelDefinition = z.object({
  handle: $ChannelHandle.describe("The channel's name in its URL, resolved against the configured team at boot"),
  triggerMode: $TriggerMode.describe(
    'mention-required: the agent acts only when explicitly @-mentioned. respond-to-all: every human post starts a turn, and the channel may hold at most one agent (§3.10).'
  )
});

export type $PluginRef = z.infer<typeof $PluginRef>;
export const $PluginRef = z.object({
  name: z
    .string()
    .regex(PLUGIN_NAME_PATTERN)
    .describe(
      "The plugin's identity: it qualifies the plugin's tools and skills (\"<name>__<capability>\") and scopes its stored records. Must equal the name the plugin's own manifest declares."
    ),
  path: z.string().min(1).describe("Path to the plugin's package root, resolved relative to config.json"),
  settings: z.unknown().optional().describe("This plugin's settings, validated against the schema the plugin declares")
});

export type $MemoryCaps = z.infer<typeof $MemoryCaps>;
export const $MemoryCaps = z.object({
  maxBodyChars: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.memoryCaps.maxBodyChars)
    .describe('Longest body one entry may hold. A longer write is refused rather than truncated.'),
  maxDescriptionChars: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.memoryCaps.maxDescriptionChars)
    .describe(
      'Longest description one entry may hold. Descriptions enter the system prompt every turn, so this bounds that cost.'
    ),
  maxEntries: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.memoryCaps.maxEntries)
    .describe('How many entries one agent may hold. Writing beyond it evicts the oldest entry.')
});

export type $MailHost = z.infer<typeof $MailHost>;
export const $MailHost = z.object({
  host: z.string().min(1).describe('Hostname of the endpoint'),
  port: z.number().int().min(1).max(65535).describe('Port of the endpoint'),
  secure: z
    .boolean()
    .describe(
      'true for implicit TLS from the first byte (typically ports 993/465); false to connect plain and upgrade via STARTTLS where the server offers it (typically ports 143/587)'
    )
});

export type $ExchangeMailProvider = z.infer<typeof $ExchangeMailProvider>;
export const $ExchangeMailProvider = z.object({
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
export const $ImapMailProvider = z.object({
  address: z
    .email()
    .describe(
      'The mailbox address this agent acts as. Fixed here and never model-supplied: the from on everything the agent sends.'
    ),
  imap: $MailHost.describe('The IMAP endpoint mail is read from'),
  kind: z.literal('imap'),
  password: z.string().min(1).describe('Password for both endpoints'),
  smtp: $MailHost.describe('The SMTP endpoint mail is sent through'),
  username: z.string().min(1).describe('Login username for both endpoints, where it differs from the address')
});

export type $MailboxDefinition = z.infer<typeof $MailboxDefinition>;
export const $MailboxDefinition = z.object({
  announcementChannel: $ChannelHandle.describe(
    'Channel where arriving mail is announced, by handle. Must not be a DM, and the agent must be a member — both refused at boot rather than discovered at runtime.'
  ),
  pollIntervalMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.mailbox.pollIntervalMs)
    .describe(
      'How often the mailbox is polled for new arrivals, each poll advancing the durable cursor. Announcement latency is bounded by this plus idle-gating.'
    ),
  provider: z
    .discriminatedUnion('kind', [$ExchangeMailProvider, $ImapMailProvider])
    .describe(
      'Which kind of provider serves this mailbox, with its credentials: Exchange Online, or generic IMAP/SMTP.'
    )
});

export type $AgentDefinition = z.infer<typeof $AgentDefinition>;
export const $AgentDefinition = z.object({
  contextBudgetTokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Overrides app.contextBudgetTokens for this agent. Absent means the app-wide value.'),
  expertise: z
    .string()
    .min(1)
    .describe(
      'What this agent should be contacted about, in a few words. Shown to every other agent so they know when to hand work over.'
    ),
  mailbox: $MailboxDefinition
    .optional()
    .describe(
      'The one email address this agent acts as. Absent means the agent has no mail capability, and a deployment with no mailbox anywhere runs exactly as it does today.'
    ),
  memoryCaps: $MemoryCaps
    .partial()
    .optional()
    .describe('Per-field overrides of app.memoryCaps for this agent. Unnamed fields keep the app-wide value.'),
  model: $ModelRef.describe('LLM model and provider for this agent'),
  skills: z
    .array(z.union([z.enum(SKILL_NAMES), $QualifiedSkillName]))
    .default([])
    .describe(
      'Names of the skills this agent is assigned: framework skills by bare name, plugin skills by their qualified "<plugin>__<skill>" name'
    ),
  systemPrompt: z.string().min(1).describe("The agent's system prompt"),
  tools: z
    .array(z.union([z.enum(TOOL_NAMES), $QualifiedToolName]))
    .default([])
    .describe(
      'Names of the tools this agent may call: framework tools by bare name, plugin tools by their qualified "<plugin>__<tool>" name'
    ),
  username: $Username.describe(
    "The agent's unique identity (a lowercase slug). Provisioning creates the Mattermost bot account of this name if it is absent."
  )
});

export type $InferenceRetryPolicy = z.infer<typeof $InferenceRetryPolicy>;
export const $InferenceRetryPolicy = z.object({
  backoffMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.inferenceRetry.backoffMs)
    .describe('Delay before the first retry of a transport failure, doubling with each further attempt'),
  maxAttempts: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.inferenceRetry.maxAttempts)
    .describe('Total attempts allowed for one completion, the first attempt included')
});

export type $DebouncePolicy = z.infer<typeof $DebouncePolicy>;
export const $DebouncePolicy = z.object({
  ceilingMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.debounce.ceilingMs)
    .describe('Hard limit on how long folding may delay a turn, so a human typing steadily still gets a response'),
  windowMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.debounce.windowMs)
    .describe(
      'How long to wait after each message before starting a turn, folding fragments into one turn for free (§4.4). Past this the running turn folds them instead, at the cost of a discarded completion. Keep it well under 5s: it is also how long the typing indicator must cover before the turn lights its own.'
    )
});

export type $AppConfig = z.infer<typeof $AppConfig>;
export const $AppConfig = z.object({
  contextBudgetTokens: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.contextBudgetTokens)
    .describe(
      'How many estimated tokens of channel history one turn may assemble (§3.8), overridable per agent. The estimate is a character ratio, not a tokenizer.'
    ),
  debounce: $DebouncePolicy.prefault({}).describe('How message fragments are folded into one turn (§4.4)'),
  enableLifecycleNotifications: z.boolean().default(CONFIG_DEFAULTS.app.enableLifecycleNotifications),
  inferenceRetry: $InferenceRetryPolicy
    .prefault({})
    .describe('How transport failures from a model provider are retried. Semantic failures are never retried.'),
  inferenceTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.inferenceTimeoutMs)
    .describe(
      'How long one completion attempt may run before it is aborted and classified as a retryable transport failure. Bounds a provider that accepts the connection and never responds.'
    ),
  logLevel: $LogLevel.default(CONFIG_DEFAULTS.app.logLevel).describe('Minimum severity the app logs'),
  memoryCaps: $MemoryCaps.prefault({}).describe('The default bounds on every agent’s memory, overridable per agent'),
  timezone: z.string().default(CONFIG_DEFAULTS.app.timezone).describe('The timezone to use when displaying dates'),
  turnCeilingPerHour: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.app.turnCeilingPerHour)
    .describe(
      'Framework-wide ceiling on turns started per rolling hour. A breach halts every agent until a human posts /resume (§7.4).'
    )
});

export type $MattermostConfig = z.infer<typeof $MattermostConfig>;
export const $MattermostConfig = z.object({
  // the default holds without the operator provisioning anything: town-square is created with every
  // team, every member is added to it automatically, and it can be neither left nor archived
  mainChannel: $ChannelHandle
    .default(CONFIG_DEFAULTS.mattermost.mainChannel)
    .describe(
      'Handle of the main channel: where the orchestrator posts its status, and the one channel in which agents answer only when explicitly @-mentioned. Every bot must be a member.'
    ),
  systemBotUsername: $Username
    .default(CONFIG_DEFAULTS.mattermost.systemBotUsername)
    .describe(
      "Username of the orchestrator's own bot account, which posts status notices and owns the slash-command surface. Not an agent, and separate from every agent. Provisioning creates it if it is absent and grants it authority to manage the team's slash commands (§8.4)."
    )
});

export type $Config = z.infer<typeof $Config>;
export const $Config = z
  .object({
    $schema: z.string().optional(),
    agents: z
      .array($AgentDefinition)
      .min(1)
      .refine((agents) => isUnique(agents.map((agent) => agent.username)), {
        message: 'agent usernames must be unique'
      }),
    app: $AppConfig.prefault({}),
    channels: z
      .array($ChannelDefinition)
      .default([])
      .describe('Per-channel triggering mode. Any channel not listed here is mention-required.'),
    mattermost: $MattermostConfig.prefault({}),
    models: z.object({
      deepseek: z
        .object({
          apiKey: z.string().min(1).describe('DeepSeek API key (https://platform.deepseek.com/api_keys)'),
          baseUrl: z
            .url()
            .default(CONFIG_DEFAULTS.models.deepseek.baseUrl)
            .describe('Base URL of the DeepSeek-compatible API')
        })
        .optional(),
      openrouter: z
        .object({
          apiKey: z.string().min(1).describe('OpenRouter API key (https://openrouter.ai/keys)'),
          baseUrl: z
            .url()
            .default(CONFIG_DEFAULTS.models.openrouter.baseUrl)
            .describe('Base URL of the OpenRouter-compatible API')
        })
        .optional()
    }),
    plugins: z
      .array($PluginRef)
      .optional()
      .refine((plugins) => !plugins || isUnique(plugins.map((plugin) => plugin.name)), {
        message: 'plugin names must be unique'
      })
  })
  .refine((config) => config.models.deepseek ?? config.models.openrouter, {
    message: 'at least one model provider must be configured'
  })
  // one account cannot be both the mechanical voice (§3.2) and an agent that thinks
  .refine((config) => config.agents.every((agent) => agent.username !== config.mattermost.systemBotUsername), {
    message: 'the system bot username must not be an agent username'
  })
  .refine(
    (config) => {
      const addresses = config.agents.flatMap((agent) => (agent.mailbox ? [agent.mailbox.provider.address] : []));
      return new Set(addresses).size === addresses.length;
    },
    { message: 'mailbox addresses must be unique across agents' }
  )
  .refine(
    (config) => {
      const clientIds = config.agents.flatMap((agent) =>
        agent.mailbox?.provider.kind === 'exchange' ? [agent.mailbox.provider.clientId] : []
      );
      return new Set(clientIds).size === clientIds.length;
    },
    {
      message:
        'Exchange client ids must be unique across agents: one app registration per mailbox is what lets the provider enforce the mailbox boundary'
    }
  )
  .refine(
    (config) => config.agents.every((agent) => !agent.tools.includes(MAIL_TOOL_NAME) || agent.mailbox !== undefined),
    { message: 'the mail tool requires a configured mailbox' }
  )
  .refine(
    (config) => config.agents.every((agent) => agent.mailbox === undefined || agent.tools.includes(MAIL_TOOL_NAME)),
    { message: 'a configured mailbox requires the mail tool' }
  );

export type Config = Omit<$Config, '$schema'>;
