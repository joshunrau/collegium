import { renderToolDisplayName } from '@collegium/core/tools';
import type { ToolRefsOf } from '@collegium/core/tools';

import { MAIL_TOOLSET } from '@/mail/mail.toolset.ts';
import { MEMORY_TOOLSET } from '@/memory/memory.toolset.ts';
import { SHELL_TOOLSET } from '@/shell/shell.toolset.ts';
import { SKILLS_TOOLSET } from '@/skills/skills.toolset.ts';
import { TRIGGERS_TOOLSET } from '@/triggers/triggers.toolset.ts';
import { WEB_TOOLSET } from '@/web/web.toolset.ts';
import { WORKSPACE_TOOLSET } from '@/workspace/workspace.toolset.ts';

type GrantableToolset = (typeof GRANTABLE_TOOLSETS)[number];

/**
 * §8 — core: in every agent's tool set, never grantable, and naming one in config is a boot
 * refusal. Framework machinery rather than capability an operator hands out.
 */
export const CORE_TOOLSETS = [SKILLS_TOOLSET, TRIGGERS_TOOLSET] as const;

export const GRANTABLE_TOOLSETS = [
  MAIL_TOOLSET,
  MEMORY_TOOLSET,
  SHELL_TOOLSET,
  WEB_TOOLSET,
  WORKSPACE_TOOLSET
] as const;

/** every framework toolset; a namespace equals its module directory name (§2) */
export const FRAMEWORK_TOOLSETS = [...CORE_TOOLSETS, ...GRANTABLE_TOOLSETS] as const;

/** what `agents[].tools` may hold for the framework: a namespace, or one tool by its `ns::tool` ref (§8) */
export type ToolGrant = GrantableToolset['name'] | ToolRefsOf<GrantableToolset>;

/**
 * The grant values the config enum admits, derived from the same declarations the type is — the
 * annotation is a type-only presentation of what the flatMap provably produces.
 */
export const TOOL_GRANT_VALUES = GRANTABLE_TOOLSETS.flatMap((toolset) => [
  toolset.name,
  ...Object.keys(toolset.tools).map((tool) => renderToolDisplayName([toolset.name, tool]))
]) as [ToolGrant, ...ToolGrant[]];
