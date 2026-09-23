import type { PluginToolsetServices } from '@collegium/core/plugins';

import { PLUGIN_WORK_UNIT_LOOKUP_TOKEN } from './plugins.tokens.ts';

export const SDK_SPECIFIER = '@collegium/sdk';

export const ZOD_SPECIFIER = 'zod';

export const CONFIG_FILE = 'src/config.ts';

export const TOOLS_DIRECTORY = 'src/tools';

export const TOOL_EXTENSION = '.ts';

export const SKILLS_DIRECTORY = 'src/skills';

/** §3.14 — declared on every assembled plugin toolset beside its config; the perimeter wrapper binds each to the turn */
export const PLUGIN_TOOLSET_SERVICES = {
  workUnitLookup: PLUGIN_WORK_UNIT_LOOKUP_TOKEN
} satisfies PluginToolsetServices;
