import type { AnyToolset, FrameworkToolsetName } from '@collegium/core/toolsets';
import { CORE_TOOLSET_DEFS, GRANTABLE_TOOLSET_DEFS } from '@collegium/core/toolsets';

import { MAIL_TOOLSET } from '@/mail/mail.toolset.ts';
import { MEMORY_TOOLSET } from '@/memory/memory.toolset.ts';
import { SHELL_TOOLSET } from '@/shell/shell.toolset.ts';
import { SKILLS_TOOLSET } from '@/skills/skills.toolset.ts';
import { TRIGGERS_TOOLSET } from '@/triggers/triggers.toolset.ts';
import { WEB_TOOLSET } from '@/web/web.toolset.ts';
import { WORKSPACE_TOOLSET } from '@/workspace/workspace.toolset.ts';

/** every framework def realised exactly once: a def left unimplemented, or an implementation no def names, is a compile error */
const IMPLEMENTATIONS = {
  mail: MAIL_TOOLSET,
  memory: MEMORY_TOOLSET,
  shell: SHELL_TOOLSET,
  skills: SKILLS_TOOLSET,
  triggers: TRIGGERS_TOOLSET,
  web: WEB_TOOLSET,
  workspace: WORKSPACE_TOOLSET
} satisfies { readonly [K in FrameworkToolsetName]: AnyToolset & { readonly name: K } };

/** §8 — the partition is the defs' to state; the app only realises it */
export const CORE_TOOLSETS: readonly AnyToolset[] = CORE_TOOLSET_DEFS.map((def) => IMPLEMENTATIONS[def.name]);

export const GRANTABLE_TOOLSETS: readonly AnyToolset[] = GRANTABLE_TOOLSET_DEFS.map((def) => IMPLEMENTATIONS[def.name]);

export const FRAMEWORK_TOOLSETS: readonly AnyToolset[] = [...CORE_TOOLSETS, ...GRANTABLE_TOOLSETS];
