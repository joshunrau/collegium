import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createServiceToken, Result } from '../../utils.ts';

import type { DefinePluginToolset, ToolsetCollection } from '../toolsets.types.ts';

const FAKE_SERVICE_TOKEN = createServiceToken<{ greet(name: string): string }>('FAKE_SERVICE');

declare const definePluginToolset: DefinePluginToolset;

test('the plugin-facing signature refuses services', () => {
  definePluginToolset({
    name: 'bookmark',
    // @ts-expect-error — a plugin toolset declares no services
    services: { fake: FAKE_SERVICE_TOKEN },
    tools: {}
  });
});

test('the plugin-facing signature refuses budgetExempt', () => {
  definePluginToolset({
    name: 'bookmark',
    tools: {
      save: {
        // @ts-expect-error — a plugin does not alter how the framework budgets actions
        budgetExempt: true,
        description: 'Save.',
        execute: () => Result.ok({ text: 'ok' }),
        parameters: z.object({})
      }
    }
  });
});

test('the plugin-facing signature types settings and storage the same way', () => {
  definePluginToolset({
    name: 'bookmark',
    settings: z.object({ maxBookmarks: z.number() }),
    storage: { bookmarks: z.object({ url: z.string() }) },
    tools: {
      save: {
        description: 'Save.',
        execute: (args, context) => {
          expectTypeOf(args).toEqualTypeOf<{ url: string }>();
          expectTypeOf(context.settings).toEqualTypeOf<{ maxBookmarks: number }>();
          expectTypeOf(context.storage.bookmarks).toEqualTypeOf<ToolsetCollection<{ url: string }>>();
          return Result.ok({ text: 'ok' });
        },
        parameters: z.object({ url: z.string() })
      }
    }
  });
});
