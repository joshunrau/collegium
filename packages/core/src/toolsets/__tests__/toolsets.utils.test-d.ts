import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createServiceToken, Result } from '../../utils.ts';
import { defineToolset, implementToolset } from '../toolsets.utils.ts';

import type { ToolTurnScope } from '../../tools.ts';
import type { AnyToolset, ToolRefsOf, ToolRefsOfDef, ToolsetCollection, ToolsetDef } from '../toolsets.types.ts';

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

test('defineToolset types each tool by its own parameters and the declared context', () => {
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

const FULL_DEF = {
  name: 'fake',
  settings: z.object({ limit: z.number() }),
  tools: ['open', 'save']
} as const satisfies ToolsetDef;

const MINIMAL_DEF = { name: 'minimal', tools: ['ping'] } as const satisfies ToolsetDef;

const IMPLEMENTED_FULL = implementToolset(FULL_DEF, {
  services: { fake: FAKE_SERVICE_TOKEN },
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

const IMPLEMENTED_MINIMAL = implementToolset(MINIMAL_DEF, {
  tools: {
    ping: {
      description: 'Ping.',
      execute: (_args, context) => {
        expectTypeOf(context.turn).toEqualTypeOf<ToolTurnScope>();
        // @ts-expect-error — the def declares no settings
        void context.settings;
        // @ts-expect-error — the implementation declares no storage
        void context.storage;
        return Result.ok({ text: 'pong' });
      },
      parameters: z.object({})
    }
  }
});

test('a def keeps its names as literals', () => {
  expectTypeOf(FULL_DEF.name).toEqualTypeOf<'fake'>();
  expectTypeOf(FULL_DEF.tools).toEqualTypeOf<readonly ['open', 'save']>();
  expectTypeOf<ToolRefsOfDef<typeof FULL_DEF | typeof MINIMAL_DEF>>().toEqualTypeOf<
    'fake::open' | 'fake::save' | 'minimal::ping'
  >();
});

test('a def refuses what only an implementation may hold', () => {
  // @ts-expect-error — services belong to the implementation, not the def
  ({ name: 'bad', services: { fake: FAKE_SERVICE_TOKEN }, tools: [] }) as const satisfies ToolsetDef;
});

test('an implementation carries the def name and flows into the registry shape', () => {
  expectTypeOf(IMPLEMENTED_FULL.name).toEqualTypeOf<'fake'>();
  expectTypeOf(IMPLEMENTED_FULL).toExtend<AnyToolset>();
  expectTypeOf(IMPLEMENTED_MINIMAL).toExtend<AnyToolset>();
});

test('a tool the def names must be implemented', () => {
  implementToolset(FULL_DEF, {
    // @ts-expect-error — `save` is declared by the def and missing here
    tools: {
      open: { description: 'Open.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) }
    }
  });
});

test('a tool the def does not name is refused', () => {
  implementToolset(MINIMAL_DEF, {
    tools: {
      ping: { description: 'Ping.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) },
      // @ts-expect-error — `pong` is not a tool of this def
      pong: { description: 'Pong.', execute: () => Result.ok({ text: 'ok' }), parameters: z.object({}) }
    }
  });
});
