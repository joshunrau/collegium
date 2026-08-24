// import { QUALIFIED_SKILL_NAME_PATTERN } from '@collegium/core/skills';
// import { TOOL_SEGMENT_PATTERN } from '@collegium/core/tools';
// import { isUnique } from '@collegium/core/utils';
// import type { LiteralUnion } from 'type-fest';
// import { z } from 'zod';

// import { DEEPSEEK_MODELS, OPENROUTER_MODELS } from '@/core/core.constants.ts';
// import { $ChannelHandle, $LogLevel } from '@/core/core.schemas.ts';
// import { CORE_SKILL_NAMES, GRANTABLE_SKILL_NAMES } from '@/skills/skills.constants.ts';
// import { CORE_TOOLSETS, TOOL_GRANT_VALUES } from '@/tools/tools.toolsets.ts';
// import type { ToolGrant } from '@/tools/tools.toolsets.ts';

// import { CONFIG_DEFAULTS } from './config.constants.ts';

// // After any change here: run `pnpm build:schema` (a test fails while the checked-in
// // config.schema.json is stale) and update config.json to match. The e2e mirrors
// // (`buildCollegiumConfig`, `Scenario`) are typed from `Config` and stop compiling on their own.

// /** plugin grants keep the same two shapes as framework grants; existence is verified at boot, after plugins load (§8) */
// const PLUGIN_GRANT_PATTERN = /^[a-z](?:_?[a-z0-9])*(?:::[a-z](?:_?[a-z0-9])*)?$/;

// const CORE_NAMESPACE_SET = new Set<string>(CORE_TOOLSETS.map((toolset) => toolset.name));

// const GRANTABLE_SKILL_NAME_SET = new Set<string>(GRANTABLE_SKILL_NAMES);

// const CORE_SKILL_NAME_SET = new Set<string>(CORE_SKILL_NAMES);

// /** per-namespace settings, validated generically at boot against the schema each toolset declares (§8) */
// const $ToolSettings = z.record(z.string().regex(TOOL_SEGMENT_PATTERN), z.unknown());

// export type $ModelRef = z.infer<typeof $ModelRef>;
// export const $ModelRef = z.discriminatedUnion('provider', [
//   z.strictObject({ name: z.enum(DEEPSEEK_MODELS), provider: z.literal('deepseek') }),
//   z.strictObject({ name: z.enum(OPENROUTER_MODELS), provider: z.literal('openrouter') })
// ]);

// /** a Mattermost account name: the slug an agent is addressed by, and its bot account's own handle */
// export type $Username = z.infer<typeof $Username>;
// export const $Username = z
//   .string()
//   .regex(/^[a-z][a-z0-9-]*$/)
//   .max(22);

// export type $TriggerMode = z.infer<typeof $TriggerMode>;
// export const $TriggerMode = z.enum(['mention-required', 'respond-to-all']);

// export type $ChannelDefinition = z.infer<typeof $ChannelDefinition>;
// export const $ChannelDefinition = z.strictObject({
//   handle: $ChannelHandle.describe("The channel's name in its URL, resolved against the configured team at boot"),
//   triggerMode: $TriggerMode.describe(
//     'mention-required: the agent acts only when explicitly @-mentioned. respond-to-all: every human post starts a turn, and the channel may hold at most one agent (§3.10).'
//   )
// });

// export type $PluginRef = z.infer<typeof $PluginRef>;
// export const $PluginRef = z.strictObject({
//   name: z
//     .string()
//     .regex(TOOL_SEGMENT_PATTERN)
//     .describe(
//       "The plugin's identity: its namespace, its storage scope, and its skills' qualifier. Must equal the name the plugin's own toolset declares."
//     ),
//   path: z.string().min(1).describe("Path to the plugin's package root, resolved relative to config.json")
// });

// /**
//  * One grant: a namespace covering every tool it holds (present and future), or a single tool by
//  * its `ns::tool` ref. This is the one place a rendered name is parsed back into segments (§1). The
//  * annotation is a type-only presentation: framework grants are the derived literal union, plugin
//  * grants are boot-verified strings.
//  */
// export type $ToolGrant = z.infer<typeof $ToolGrant>;
// export const $ToolGrant = z
//   .string()
//   .check((ctx) => {
//     const namespace = ctx.value.split('::')[0] ?? ctx.value;
//     if (CORE_NAMESPACE_SET.has(namespace)) {
//       ctx.issues.push({
//         code: 'custom',
//         input: ctx.value,
//         message: `"${ctx.value}" is core — always enabled and never granted`
//       });
//       return;
//     }
//     if (!PLUGIN_GRANT_PATTERN.test(ctx.value)) {
//       ctx.issues.push({
//         code: 'custom',
//         input: ctx.value,
//         message: `"${ctx.value}" is not a namespace or a "namespace::tool" ref`
//       });
//     }
//   })
//   .describe(
//     `A toolset namespace, or one tool by its "namespace::tool" ref. Framework values: ${TOOL_GRANT_VALUES.join(', ')}. Plugin grants use the plugin's namespace the same way.`
//   ) as unknown as z.ZodType<LiteralUnion<ToolGrant, string>, LiteralUnion<ToolGrant, string>>;

// /** a framework library skill by bare name, or a toolset-shipped skill by its `ns::skill` name (§9) */
// export type $SkillGrant = z.infer<typeof $SkillGrant>;
// export const $SkillGrant = z.string().check((ctx) => {
//   if (CORE_SKILL_NAME_SET.has(ctx.value)) {
//     ctx.issues.push({
//       code: 'custom',
//       input: ctx.value,
//       message: `"${ctx.value}" is a core skill — always assigned and never granted`
//     });
//     return;
//   }
//   if (!GRANTABLE_SKILL_NAME_SET.has(ctx.value) && !QUALIFIED_SKILL_NAME_PATTERN.test(ctx.value)) {
//     ctx.issues.push({
//       code: 'custom',
//       input: ctx.value,
//       message: `"${ctx.value}" is neither a framework skill nor a "namespace::skill" name`
//     });
//   }
// });

// export type $AgentDefinition = z.infer<typeof $AgentDefinition>;
// export const $AgentDefinition = z.strictObject({
//   contextBudgetTokens: z
//     .number()
//     .int()
//     .positive()
//     .optional()
//     .describe('Overrides app.contextBudgetTokens for this agent. Absent means the app-wide value.'),
//   expertise: z
//     .string()
//     .min(1)
//     .describe(
//       'What this agent should be contacted about, in a few words. Shown to every other agent so they know when to hand work over.'
//     ),
//   model: $ModelRef.describe('LLM model and provider for this agent'),
//   skills: z
//     .array($SkillGrant)
//     .default([])
//     .describe(
//       'Skills assigned to this agent: framework skills by bare name, toolset-shipped skills as "namespace::skill". Core skills are always assigned.'
//     ),
//   systemPrompt: z.string().min(1).describe("The agent's system prompt"),
//   tools: z
//     .array($ToolGrant)
//     .default([])
//     .describe(
//       'Toolsets and tools this agent may call: a namespace grants every tool it holds, "namespace::tool" grants one. Core tools are always available and never named here.'
//     ),
//   toolSettings: $ToolSettings
//     .default({})
//     .describe(
//       'Per-namespace settings for this agent, merged shallowly over app.defaultToolSettings and validated against the schema the toolset declares. Settings for an ungranted toolset are refused at boot.'
//     ),
//   username: $Username.describe(
//     "The agent's unique identity (a lowercase slug). Provisioning creates the Mattermost bot account of this name if it is absent."
//   )
// });

// export type $InferenceRetryPolicy = z.infer<typeof $InferenceRetryPolicy>;
// export const $InferenceRetryPolicy = z.strictObject({
//   backoffMs: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.inferenceRetry.backoffMs)
//     .describe('Delay before the first retry of a transport failure, doubling with each further attempt'),
//   maxAttempts: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.inferenceRetry.maxAttempts)
//     .describe('Total attempts allowed for one completion, the first attempt included')
// });

// export type $DebouncePolicy = z.infer<typeof $DebouncePolicy>;
// export const $DebouncePolicy = z.strictObject({
//   ceilingMs: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.debounce.ceilingMs)
//     .describe('Hard limit on how long folding may delay a turn, so a human typing steadily still gets a response'),
//   windowMs: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.debounce.windowMs)
//     .describe(
//       'How long to wait after each message before starting a turn, folding fragments into one turn for free (§4.4). Past this the running turn folds them instead, at the cost of a discarded completion. Keep it well under 5s: it is also how long the typing indicator must cover before the turn lights its own.'
//     )
// });

// export type $AppConfig = z.infer<typeof $AppConfig>;
// export const $AppConfig = z.strictObject({
//   contextBudgetTokens: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.contextBudgetTokens)
//     .describe(
//       'How many estimated tokens of channel history one turn may assemble (§3.8), overridable per agent. The estimate is a character ratio, not a tokenizer.'
//     ),
//   debounce: $DebouncePolicy.prefault({}).describe('How message fragments are folded into one turn (§4.4)'),
//   defaultToolSettings: $ToolSettings
//     .default({})
//     .describe(
//       'App-wide per-namespace settings, merged shallowly under each agent’s own toolSettings. Shallow: an agent overriding a field replaces it whole.'
//     ),
//   enableLifecycleNotifications: z.boolean().default(CONFIG_DEFAULTS.app.enableLifecycleNotifications),
//   inferenceRetry: $InferenceRetryPolicy
//     .prefault({})
//     .describe('How transport failures from a model provider are retried. Semantic failures are never retried.'),
//   inferenceTimeoutMs: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.inferenceTimeoutMs)
//     .describe(
//       'How long one completion attempt may run before it is aborted and classified as a retryable transport failure. Bounds a provider that accepts the connection and never responds.'
//     ),
//   logLevel: $LogLevel.default(CONFIG_DEFAULTS.app.logLevel).describe('Minimum severity the app logs'),
//   timezone: z.string().default(CONFIG_DEFAULTS.app.timezone).describe('The timezone to use when displaying dates'),
//   turnCeilingPerHour: z
//     .number()
//     .int()
//     .positive()
//     .default(CONFIG_DEFAULTS.app.turnCeilingPerHour)
//     .describe(
//       'Framework-wide ceiling on turns started per rolling hour. A breach halts every agent until a human posts /resume (§7.4).'
//     )
// });

// export type $MattermostConfig = z.infer<typeof $MattermostConfig>;
// export const $MattermostConfig = z.strictObject({
//   // the default holds without the operator provisioning anything: town-square is created with every
//   // team, every member is added to it automatically, and it can be neither left nor archived
//   mainChannel: $ChannelHandle
//     .default(CONFIG_DEFAULTS.mattermost.mainChannel)
//     .describe(
//       'Handle of the main channel: where the orchestrator posts its status, and the one channel in which agents answer only when explicitly @-mentioned. Every bot must be a member.'
//     ),
//   systemBotUsername: $Username
//     .default(CONFIG_DEFAULTS.mattermost.systemBotUsername)
//     .describe(
//       "Username of the orchestrator's own bot account, which posts status notices and owns the slash-command surface. Not an agent, and separate from every agent. Provisioning creates it if it is absent and grants it authority to manage the team's slash commands (§8.4)."
//     )
// });

// export type $Config = z.infer<typeof $Config>;
// export const $Config = z
//   .strictObject({
//     $schema: z.string().optional(),
//     agents: z
//       .array($AgentDefinition)
//       .min(1)
//       .refine((agents) => isUnique(agents.map((agent) => agent.username)), {
//         message: 'agent usernames must be unique'
//       }),
//     app: $AppConfig.prefault({}),
//     channels: z
//       .array($ChannelDefinition)
//       .default([])
//       .describe('Per-channel triggering mode. Any channel not listed here is mention-required.'),
//     mattermost: $MattermostConfig.prefault({}),
//     models: z.strictObject({
//       deepseek: z
//         .strictObject({
//           apiKey: z.string().min(1).describe('DeepSeek API key (https://platform.deepseek.com/api_keys)'),
//           baseUrl: z
//             .url()
//             .default(CONFIG_DEFAULTS.models.deepseek.baseUrl)
//             .describe('Base URL of the DeepSeek-compatible API')
//         })
//         .optional(),
//       openrouter: z
//         .strictObject({
//           apiKey: z.string().min(1).describe('OpenRouter API key (https://openrouter.ai/keys)'),
//           baseUrl: z
//             .url()
//             .default(CONFIG_DEFAULTS.models.openrouter.baseUrl)
//             .describe('Base URL of the OpenRouter-compatible API')
//         })
//         .optional()
//     }),
//     plugins: z
//       .array($PluginRef)
//       .optional()
//       .refine((plugins) => !plugins || isUnique(plugins.map((plugin) => plugin.name)), {
//         message: 'plugin names must be unique'
//       })
//   })
//   .refine((config) => config.models.deepseek ?? config.models.openrouter, {
//     message: 'at least one model provider must be configured'
//   })
//   // one account cannot be both the mechanical voice (§3.2) and an agent that thinks
//   .refine((config) => config.agents.every((agent) => agent.username !== config.mattermost.systemBotUsername), {
//     message: 'the system bot username must not be an agent username'
//   });

// export type Config = Omit<$Config, '$schema'>;
