import { PLUGIN_TOOL_ERR } from '@collegium/core/plugins';
import type { ToolTurnScope } from '@collegium/core/tools';
import type { ToolsetCollection } from '@collegium/core/toolsets';
import type { z } from 'zod';

import type { PluginConfig } from './config.ts';
import type { ToolContextFor } from './tool.ts';

const DEFAULT_TURN: ToolTurnScope = {
  agentUsername: 'tester',
  channelId: 'test-channel',
  triggeringPostId: null,
  turnId: 'test-turn'
};

function createCollection(schema: z.ZodType): ToolsetCollection<unknown> {
  const rows = new Map<string, unknown>();
  return {
    delete: (key) => Promise.try(() => rows.delete(key)),
    get: (key) => Promise.try(() => (rows.has(key) ? schema.parse(rows.get(key)) : null)),
    list: () => Promise.try(() => [...rows].map(([key, value]) => ({ key, value: schema.parse(value) }))),
    put: (key, value) =>
      Promise.try(() => {
        rows.set(key, schema.parse(value));
      })
  };
}

/** `settings` as the declared schema accepts them, so defaults apply as they do at boot; `turn` overrides the four facts */
export type TestContextOptions<TConfig extends PluginConfig> = {
  readonly settings?: TConfig['settings'] extends z.ZodType ? z.input<TConfig['settings']> : never;
  readonly turn?: Partial<ToolTurnScope>;
};

/**
 * The context a deployment hands `execute`, over in-memory storage: each declared collection
 * validates on write and parses on read as the real store does, settings pass through the declared
 * schema so defaults apply, and `err` raises exactly what the framework's wrapper catches.
 */
export function createTestContext<TConfig extends PluginConfig>(
  config: TConfig,
  options: TestContextOptions<TConfig> = {}
): ToolContextFor<TConfig> {
  const storage = Object.fromEntries(
    Object.entries(config.storage).map(([name, schema]) => [name, createCollection(schema)])
  );
  const context = { err: PLUGIN_TOOL_ERR, storage, turn: { ...DEFAULT_TURN, ...options.turn } };
  const settings = config.settings === undefined ? {} : { settings: config.settings.parse(options.settings ?? {}) };
  return { ...context, ...settings } as ToolContextFor<TConfig>;
}

export { PluginToolFailureError } from '@collegium/core/plugins';
