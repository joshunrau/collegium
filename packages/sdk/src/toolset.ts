import { defineToolset as frameworkDefineToolset } from '@collegium/core/tools';
import type { DefinePluginToolset } from '@collegium/core/tools';

/**
 * The same function the framework declares toolsets with (§7), narrowed to the plugin surface: no
 * `services`, no `budgetExempt`. The narrowing is type-level here and structural at the load
 * perimeter, where either key is an unrecognized-key refusal.
 */
export const defineToolset: DefinePluginToolset = frameworkDefineToolset;
