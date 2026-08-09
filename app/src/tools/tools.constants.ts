import { MAIL_TOOL_NAME } from '@/mail/mail.constants.ts';
import { READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME } from '@/memory/memory.constants.ts';
import { SHELL_TOOL_NAME } from '@/shell/shell.constants.ts';
import { LOAD_SKILL_TOOL_NAME } from '@/skills/skills.constants.ts';
import { RESOLVE_TRIGGER_TOOL_NAME } from '@/triggers/triggers.constants.ts';
import { BROWSER_TOOL_NAME } from '@/web/web.constants.ts';

/** the one tool owned by no service module, so its name lives here */
export const WRITE_FILE_TOOL_NAME = 'write_file';

/**
 * Every tool name that exists, assembled from the owning modules' leaf constants files — each
 * name declared exactly once, imported here and by its tool class. Leaf constants only:
 * `config.schemas.ts` needs these values while its module evaluates, and the tool classes'
 * constructor injection reaches `ConfigService` at runtime — deriving the names from the classes
 * would close an import cycle at boot. `TOOL_CLASSES` in `tools.module.ts` is positionally pinned
 * to this list, so a name without an implementing class cannot compile.
 */
export const TOOL_NAMES = [
  BROWSER_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  MAIL_TOOL_NAME,
  READ_MEMORY_TOOL_NAME,
  RESOLVE_TRIGGER_TOOL_NAME,
  SHELL_TOOL_NAME,
  WRITE_FILE_TOOL_NAME,
  WRITE_MEMORY_TOOL_NAME
] as const;
