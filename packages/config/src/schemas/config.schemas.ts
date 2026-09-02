import { $ChannelHandle, $LogLevel, DEEPSEEK_MODELS, OPENROUTER_MODELS } from '@collegium/core/common';
import {
  BUILTIN_CORE_SKILL_NAMES,
  BUILTIN_GRANTABLE_SKILL_NAMES,
  QUALIFIED_SKILL_NAME_PATTERN
} from '@collegium/core/skills';
import { TOOL_SEGMENT_PATTERN } from '@collegium/core/tools';
import { CORE_TOOLSET_DEFS, TOOL_GRANT_GROUPS } from '@collegium/core/toolsets';
import type { ToolGrant } from '@collegium/core/toolsets';
import { isUnique } from '@collegium/core/utils';
import type { LiteralUnion } from 'type-fest';
import { z } from 'zod';

import { CONFIG_DEFAULTS } from '../constants.ts';
import { schemaTable } from '../meta.ts';

// After any change here, update the root config.json to match; `pnpm build` regenerates
// dist/config.schema.json. The e2e mirror (`buildCollegiumConfig`) is typed from `ConfigInput` and
// stops compiling on its own.
//
// Where a key lives: a thing the deployment has is an entry in its noun's collection (agents,
// mattermost.channels, providers, plugins); a value an agent runs with is a key on the agent, and
// on agentDefaults when it can be stated once for every agent; a toolset's knob is a field of that
// toolset's own settings schema and never appears here; a framework-wide behaviour goes in the
// section named for the SPEC concept that defines it.

/** plugin grants keep the same two shapes as framework grants; existence is verified at boot, after plugins load (§8) */
const PLUGIN_GRANT_PATTERN = /^[a-z](?:_?[a-z0-9])*(?:::[a-z](?:_?[a-z0-9])*)?$/;

const CORE_NAMESPACE_SET = new Set<string>(CORE_TOOLSET_DEFS.map((def) => def.name));

const GRANTABLE_SKILL_NAME_SET = new Set<string>(BUILTIN_GRANTABLE_SKILL_NAMES);

const CORE_SKILL_NAME_SET = new Set<string>(BUILTIN_CORE_SKILL_NAMES);

/** per-namespace settings, validated generically at boot against the schema each toolset declares (§8) */
export type $ToolSettings = z.infer<typeof $ToolSettings>;
export const $ToolSettings = z.record(z.string().regex(TOOL_SEGMENT_PATTERN), z.unknown());

export type $ModelRef = z.infer<typeof $ModelRef>;
export const $ModelRef = z
  .discriminatedUnion('provider', [
    z.strictObject({ name: z.enum(DEEPSEEK_MODELS), provider: z.literal('deepseek') }),
    z.strictObject({ name: z.enum(OPENROUTER_MODELS), provider: z.literal('openrouter') })
  ])
  .describe('The model an agent thinks with. Its provider must be configured under providers.');

export type $ContextBudgetTokens = z.infer<typeof $ContextBudgetTokens>;
export const $ContextBudgetTokens = z
  .number()
  .int()
  .positive()
  .describe(
    'How many estimated tokens of channel history one turn may assemble (§3.8). The estimate is a character ratio, not a tokenizer.'
  );

/** a Mattermost account name: the slug an agent is addressed by, and its bot account's own handle */
export type $Username = z.infer<typeof $Username>;
export const $Username = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(22);

export type $TriggeringMode = z.infer<typeof $TriggeringMode>;
export const $TriggeringMode = z.enum(['mention-required', 'respond-to-all']);

export type $ChannelDefinition = z.infer<typeof $ChannelDefinition>;
export const $ChannelDefinition = z.strictObject({
  triggeringMode: $TriggeringMode.describe(
    'mention-required: the agent acts only when explicitly @-mentioned. respond-to-all: every human post starts a turn, and the channel may hold at most one agent (§3.10).'
  )
});

export type $PluginName = z.infer<typeof $PluginName>;
export const $PluginName = z
  .string()
  .regex(TOOL_SEGMENT_PATTERN)
  .describe(
    "The plugin's identity, stated once: the directory holding it beneath the plugin root, and the namespace its tools, storage, and skills appear under."
  );

/**
 * One grant: a namespace covering every tool it holds (present and future), or a single tool by
 * its `ns::tool` ref. This is the one place a rendered name is parsed back into segments (§1). The
 * annotation is a type-only presentation: framework grants are the derived literal union, plugin
 * grants are boot-verified strings.
 */
export type $ToolGrant = z.infer<typeof $ToolGrant>;
export const $ToolGrant = z
  .string()
  .check((ctx) => {
    const namespace = ctx.value.split('::')[0] ?? ctx.value;
    if (CORE_NAMESPACE_SET.has(namespace)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: `"${ctx.value}" is core — always enabled and never granted`
      });
      return;
    }
    if (!PLUGIN_GRANT_PATTERN.test(ctx.value)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: `"${ctx.value}" is not a namespace or a "namespace::tool" ref`
      });
    }
  })
  .describe(
    'A toolset namespace, or one tool by its "namespace::tool" ref. Plugin grants use the plugin\'s namespace the same way.'
  )
  .meta(schemaTable({ rows: TOOL_GRANT_GROUPS, title: 'Built-in options' })) as unknown as z.ZodType<
  LiteralUnion<ToolGrant, string>,
  LiteralUnion<ToolGrant, string>
>;

/** a framework library skill by bare name, or a toolset-shipped skill by its `ns::skill` name (§9) */
export type $SkillGrant = z.infer<typeof $SkillGrant>;
export const $SkillGrant = z.string().check((ctx) => {
  if (CORE_SKILL_NAME_SET.has(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `"${ctx.value}" is a core skill — always assigned and never granted`
    });
    return;
  }
  if (!GRANTABLE_SKILL_NAME_SET.has(ctx.value) && !QUALIFIED_SKILL_NAME_PATTERN.test(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `"${ctx.value}" is neither a framework skill nor a "namespace::skill" name`
    });
  }
});

export type $AgentDefaults = z.infer<typeof $AgentDefaults>;
export const $AgentDefaults = z.strictObject({
  contextBudgetTokens: $ContextBudgetTokens.default(CONFIG_DEFAULTS.agentDefaults.contextBudgetTokens),
  model: $ModelRef.optional(),
  toolSettings: $ToolSettings
    .default({})
    .describe(
      'Per-namespace settings every agent granted that namespace starts from. An agent’s own toolSettings merge over these shallowly, per namespace: a field the agent states replaces that field whole, and the rest keep their defaults.'
    )
});

/** one agent as written: its username is the key it sits under */
export type $AgentDeclaration = z.infer<typeof $AgentDeclaration>;
export const $AgentDeclaration = z.strictObject({
  contextBudgetTokens: $ContextBudgetTokens
    .optional()
    .describe('Overrides agentDefaults.contextBudgetTokens for this agent'),
  expertise: z
    .string()
    .min(1)
    .describe(
      'What this agent should be contacted about, in a few words. Shown to every other agent so they know when to hand work over.'
    ),
  model: $ModelRef.optional().describe('Overrides agentDefaults.model. Required when no default is set.'),
  skills: z
    .array($SkillGrant)
    .default([])
    .describe(
      'Skills assigned to this agent: framework skills by bare name, toolset-shipped skills as "namespace::skill". Core skills are always assigned.'
    ),
  systemPrompt: z.string().min(1).describe("The agent's system prompt"),
  tools: z
    .array($ToolGrant)
    .default([])
    .describe(
      'Toolsets and tools this agent may call: a namespace grants every tool it holds, "namespace::tool" grants one. Core tools are always available and never named here.'
    ),
  toolSettings: $ToolSettings
    .default({})
    .describe(
      'Per-namespace settings for this agent, merged shallowly over agentDefaults.toolSettings and validated against the schema the toolset declares. Settings for an ungranted toolset are refused at boot.'
    )
});

export type $DebouncePolicy = z.infer<typeof $DebouncePolicy>;
export const $DebouncePolicy = z.strictObject({
  ceilingMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.activation.debounce.ceilingMs)
    .describe('Hard limit on how long folding may delay a turn, so a human typing steadily still gets a response'),
  windowMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.activation.debounce.windowMs)
    .describe(
      'How long to wait after each message before starting a turn, folding fragments into one turn for free (§4.4). Past this the running turn folds them instead, at the cost of a discarded completion. Keep it well under 5s: it is also how long the typing indicator must cover before the turn lights its own.'
    )
});

export type $ActivationConfig = z.infer<typeof $ActivationConfig>;
export const $ActivationConfig = z.strictObject({
  debounce: $DebouncePolicy
    .prefault({})
    .describe('The window before a turn starts, during which further fragments fold into it (§4.4)'),
  foldLimit: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.activation.foldLimit)
    .describe(
      'How many times one running turn may discard its completion to absorb a further fragment (§4.4). Bounds the folding after a turn exists, as the debounce ceiling bounds the window before it.'
    )
});

export type $TurnsConfig = z.infer<typeof $TurnsConfig>;
export const $TurnsConfig = z.strictObject({
  actionBudget: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.turns.actionBudget)
    .describe(
      'Action attempts one turn may make before it must ask to continue (§5.3): every model-emitted tool invocation counts, denied ones included. An approved extension grants this many more.'
    ),
  delegationDepthLimit: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.turns.delegationDepthLimit)
    .describe(
      'How many agent-to-agent hops from the nearest human a delegation chain may reach (§7.4). At the limit, mentions of a peer are stripped and the turn says so.'
    ),
  hourlyCeiling: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.turns.hourlyCeiling)
    .describe(
      'Framework-wide ceiling on turns started per rolling hour. A breach halts every agent until a human posts /collegium.resume (§7.4).'
    )
});

export type $InferenceRetryPolicy = z.infer<typeof $InferenceRetryPolicy>;
export const $InferenceRetryPolicy = z.strictObject({
  backoffMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.inference.retry.backoffMs)
    .describe('Delay before the first retry of a transport failure, doubling with each further attempt'),
  maxAttempts: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.inference.retry.maxAttempts)
    .describe('Total attempts allowed for one completion, the first attempt included')
});

export type $InferenceConfig = z.infer<typeof $InferenceConfig>;
export const $InferenceConfig = z.strictObject({
  retry: $InferenceRetryPolicy
    .prefault({})
    .describe('How transport failures from a model provider are retried (§7.2). Semantic failures are never retried.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(CONFIG_DEFAULTS.inference.timeoutMs)
    .describe(
      'How long one completion attempt may run before it is aborted and classified as a retryable transport failure. Bounds a provider that accepts the connection and never responds.'
    )
});

export type $LoggingConfig = z.infer<typeof $LoggingConfig>;
export const $LoggingConfig = z.strictObject({
  level: $LogLevel.default(CONFIG_DEFAULTS.logging.level).describe('Minimum severity the app logs')
});

export type $NotificationsConfig = z.infer<typeof $NotificationsConfig>;
export const $NotificationsConfig = z.strictObject({
  lifecycle: z
    .boolean()
    .default(CONFIG_DEFAULTS.notifications.lifecycle)
    .describe(
      'Whether the system bot posts a notice in the main channel when the app comes online, naming the downtime and the turns it abandoned, and again when it shuts down (§3.2, §7.3)'
    )
});

export type $DisplayConfig = z.infer<typeof $DisplayConfig>;
export const $DisplayConfig = z.strictObject({
  timezone: z
    .string()
    .default(CONFIG_DEFAULTS.display.timezone)
    .describe('The IANA timezone every date rendered into a post is shown in')
});

export type $MattermostConfig = z.infer<typeof $MattermostConfig>;
export const $MattermostConfig = z.strictObject({
  channels: z
    .record(
      $ChannelHandle.meta({
        description: "The channel's name in its URL, resolved against the team at boot",
        title: 'handle'
      }),
      $ChannelDefinition
    )
    .default({})
    .describe(
      "Per-channel triggering mode, by handle. Any channel not listed is mention-required. Each listed channel is created at provisioning if absent and holds the system bot, plus a mailbox owner when it is the channel that agent's arrivals are announced to. Which other agents belong in it is set in Mattermost, not here."
    ),
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

export type $ProvidersConfig = z.infer<typeof $ProvidersConfig>;
export const $ProvidersConfig = z.strictObject({
  deepseek: z
    .strictObject({
      apiKey: z.string().min(1).describe('DeepSeek API key (https://platform.deepseek.com/api_keys)'),
      baseUrl: z
        .url()
        .default(CONFIG_DEFAULTS.providers.deepseek.baseUrl)
        .describe('Base URL of the DeepSeek-compatible API')
    })
    .optional()
    .describe('DeepSeek, reached directly'),
  openrouter: z
    .strictObject({
      apiKey: z.string().min(1).describe('OpenRouter API key (https://openrouter.ai/keys)'),
      baseUrl: z
        .url()
        .default(CONFIG_DEFAULTS.providers.openrouter.baseUrl)
        .describe('Base URL of the OpenRouter-compatible API')
    })
    .optional()
    .describe('OpenRouter, fronting many providers under one key')
});

/** config.json as written, before its cross-references are resolved */
export type $ConfigDeclaration = z.infer<typeof $ConfigDeclaration>;
export const $ConfigDeclaration = z.strictObject({
  $schema: z
    .string()
    .optional()
    .describe('Path or URL of the JSON Schema an editor validates this file against; ignored by the app'),
  activation: $ActivationConfig
    .prefault({})
    .describe('When a turn starts: how a human’s fragments fold into one turn (§4.4)'),
  agentDefaults: $AgentDefaults
    .prefault({})
    .describe(
      'Values every agent runs with unless its own entry states otherwise — the same keys, the same shapes. Grants and identity are never defaulted.'
    ),
  agents: z
    .record(
      $Username.meta({
        description: "The agent's username: how it is addressed, and its bot account's own handle",
        title: 'username'
      }),
      $AgentDeclaration
    )
    .describe(
      'The agents this deployment runs, by username, each a persistent identity with its own prompt, model, and grants (§3.1). Provisioning creates the bot account of that name if it is absent.'
    ),
  display: $DisplayConfig.prefault({}).describe('How facts are rendered for humans, not what they are'),
  inference: $InferenceConfig
    .prefault({})
    .describe('The transport to model providers: how long a completion may take and how failures are retried (§7.2)'),
  logging: $LoggingConfig.prefault({}).describe('What the app logs'),
  mattermost: $MattermostConfig
    .prefault({})
    .describe(
      'What the deployment expects of its Mattermost team beyond what the environment locates: the main channel, the system bot, and each channel’s triggering mode'
    ),
  notifications: $NotificationsConfig
    .prefault({})
    .describe('Which of the system bot’s deterministic notices are posted (§3.2)'),
  plugins: z
    .array($PluginName)
    .refine((plugins) => isUnique(plugins), { message: 'plugin names must be unique' })
    .default([])
    .describe(
      'Plugins to load at boot, by name. Each is a directory of that name beneath the plugin root, contributing one toolset under its own namespace (§3.14)'
    ),
  providers: $ProvidersConfig
    .prefault({})
    .describe(
      'Credentials for each model provider an agent may name. A provider a model names must be configured here.'
    ),
  turns: $TurnsConfig.prefault({}).describe('The bounds on a turn and on chains of turns (§5.3, §7.4)')
});
