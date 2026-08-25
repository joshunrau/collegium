import { renderToolDisplayName } from '../tools.ts';
import { $MailSettings, $MemorySettings } from './toolsets.schemas.ts';

import type { ToolsetDef } from './toolsets.types.ts';

export const MAIL_TOOLSET_DEF = {
  name: 'mail',
  settings: $MailSettings,
  tools: ['conversation', 'list', 'open', 'reply', 'search', 'send']
} as const satisfies ToolsetDef;

export const MEMORY_TOOLSET_DEF = {
  name: 'memory',
  settings: $MemorySettings,
  tools: ['read', 'write']
} as const satisfies ToolsetDef;

export const SHELL_TOOLSET_DEF = { name: 'shell', tools: ['run'] } as const satisfies ToolsetDef;

export const SKILLS_TOOLSET_DEF = { name: 'skills', tools: ['load'] } as const satisfies ToolsetDef;

export const TRIGGERS_TOOLSET_DEF = { name: 'triggers', tools: ['resolve'] } as const satisfies ToolsetDef;

export const WEB_TOOLSET_DEF = { name: 'web', tools: ['click', 'fill', 'navigate'] } as const satisfies ToolsetDef;

export const WORKSPACE_TOOLSET_DEF = { name: 'workspace', tools: ['write'] } as const satisfies ToolsetDef;

/**
 * §8 — core: in every agent's tool set, never grantable, and naming one in config is a boot
 * refusal. Framework machinery rather than capability an operator hands out.
 */
export const CORE_TOOLSET_DEFS = [SKILLS_TOOLSET_DEF, TRIGGERS_TOOLSET_DEF] as const;

export const GRANTABLE_TOOLSET_DEFS = [
  MAIL_TOOLSET_DEF,
  MEMORY_TOOLSET_DEF,
  SHELL_TOOLSET_DEF,
  WEB_TOOLSET_DEF,
  WORKSPACE_TOOLSET_DEF
] as const;

/** every framework toolset; a namespace equals its module directory name in the app (§2) */
export const FRAMEWORK_TOOLSET_DEFS = [...CORE_TOOLSET_DEFS, ...GRANTABLE_TOOLSET_DEFS] as const;

/** what `agents[].tools` may hold for the framework, rendered: each namespace, then each of its tools by ref (§8) */
export const TOOL_GRANT_VALUES: readonly string[] = GRANTABLE_TOOLSET_DEFS.flatMap((def) => [
  def.name,
  ...def.tools.map((tool) => renderToolDisplayName([def.name, tool]))
]);
