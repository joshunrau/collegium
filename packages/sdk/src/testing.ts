import { PLUGIN_TOOL_ERR } from '@collegium/core/plugins';
import type { ToolTurnScope } from '@collegium/core/tools';
import { applyCollectionQuery } from '@collegium/core/toolsets';
import type { AnyToolsetCollection, CollectionRecord } from '@collegium/core/toolsets';
import type { z } from 'zod';

import type { PluginConfig } from './config.ts';
import type { ToolContextFor } from './tool.ts';

type LooseRecord = CollectionRecord<{ [field: string]: unknown }>;

const DEFAULT_TURN: ToolTurnScope = {
  agentUsername: 'tester',
  channelId: 'test-channel',
  triggeringPostId: null,
  turnId: 'test-turn'
};

/** the deployment's store mints a cuid2; here any unique string serves, and a test that needs a known id passes one */
function createCollection(schema: z.ZodObject): AnyToolsetCollection {
  const rows = new Map<string, LooseRecord>();
  const toRecord = ({ createdAt, id, updatedAt, ...value }: LooseRecord): LooseRecord => ({
    ...schema.parse(value),
    createdAt,
    id,
    updatedAt
  });
  return {
    create: ({ id = crypto.randomUUID(), ...data }) => {
      return Promise.try(() => {
        if (rows.has(id)) {
          throw new Error(`storage collection already holds a record with id "${id}"`);
        }
        const now = new Date();
        rows.set(id, { ...schema.parse(data), createdAt: now, id, updatedAt: now });
        return toRecord(rows.get(id)!);
      });
    },
    deleteById: (id) => Promise.try(() => rows.delete(id)),
    findById: (id) => Promise.try(() => (rows.has(id) ? toRecord(rows.get(id)!) : null)),
    findMany: (query = {}) => Promise.try(() => applyCollectionQuery([...rows.values()].map(toRecord), query)),
    updateById: (id, patch) => {
      return Promise.try(() => {
        const row = rows.get(id);
        if (row === undefined) {
          return null;
        }
        const { createdAt, id: _id, updatedAt: _updatedAt, ...value } = row;
        rows.set(id, { ...schema.parse({ ...schema.parse(value), ...patch }), createdAt, id, updatedAt: new Date() });
        return toRecord(rows.get(id)!);
      });
    }
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
