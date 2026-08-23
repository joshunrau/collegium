import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { Result } from '../../utils.ts';
import { createServiceToken, defineToolset } from '../toolsets.definition.ts';

import type {
  AnyToolset,
  DefinePluginToolset,
  ToolRefsOf,
  ToolsetCollection,
  ToolTurnScope
} from '../toolsets.definition.ts';

type FakeService = { greet(name: string): string };
const FAKE_SERVICE_TOKEN = createServiceToken<FakeService>('FAKE_SERVICE');

const FULL_TOOLSET = defineToolset({
  name: 'fake',
  services: { fake: FAKE_SERVICE_TOKEN },
  settings: z.object({ limit: z.number() }),
  storage: { rows: z.object({ url: z.string() }) },
  tools: {
    open: {
      description: 'Open a row.',
      execute: (args) => {
        expectTypeOf(args).toEqualTypeOf<{ id: number }>();
        return Result.ok({ text: 'opened' });
      },
      parameters: z.object({ id: z.number() })
    },
    save: {
      description: 'Save a row.',
      execute: (args, context) => {
        expectTypeOf(args).toEqualTypeOf<{ url: string }>();
        expectTypeOf(context.fake).toEqualTypeOf<FakeService>();
        expectTypeOf(context.settings).toEqualTypeOf<{ limit: number }>();
        expectTypeOf(context.storage.rows).toEqualTypeOf<ToolsetCollection<{ url: string }>>();
        expectTypeOf(context.turn).toEqualTypeOf<ToolTurnScope>();
        return Result.ok({ text: 'saved' });
      },
      parameters: z.object({ url: z.string() })
    }
  }
});

const MINIMAL_TOOLSET = defineToolset({
  name: 'minimal',
  tools: {
    ping: {
      description: 'Ping.',
      execute: (_args, context) => {
        expectTypeOf(context.turn).toEqualTypeOf<ToolTurnScope>();
        // @ts-expect-error — settings was not declared by this toolset
        void context.settings;
        // @ts-expect-error — storage was not declared by this toolset
        void context.storage;
        // @ts-expect-error — no such service was declared
        void context.fake;
        return Result.ok({ text: 'pong' });
      },
      parameters: z.object({})
    }
  }
});

test('each tool is typed by its own parameters and the declared context', () => {
  expectTypeOf(FULL_TOOLSET.name).toEqualTypeOf<'fake'>();
  expectTypeOf(MINIMAL_TOOLSET.name).toEqualTypeOf<'minimal'>();
});

test('names survive into the type as a literal union', () => {
  expectTypeOf<ToolRefsOf<typeof FULL_TOOLSET>>().toEqualTypeOf<'fake::open' | 'fake::save'>();
});

test('the ref union distributes over a union of toolsets', () => {
  expectTypeOf<ToolRefsOf<typeof FULL_TOOLSET | typeof MINIMAL_TOOLSET>>().toEqualTypeOf<
    'fake::open' | 'fake::save' | 'minimal::ping'
  >();
});

test('a concrete declaration flows into the loose registry shape', () => {
  expectTypeOf(FULL_TOOLSET).toExtend<AnyToolset>();
  expectTypeOf(MINIMAL_TOOLSET).toExtend<AnyToolset>();
});

test('a service may not shadow a context key of the framework', () => {
  defineToolset({
    name: 'bad',
    // @ts-expect-error — `turn` is the context's own key
    services: { turn: FAKE_SERVICE_TOKEN },
    tools: {}
  });
});

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
