import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { $PluginTool, toFrameworkTool } from '../../plugins.ts';

import type { PluginToolErr } from '../../plugins.ts';

const CONTEXT = {} as never;

function wrap(execute: (args: unknown, context: { err: PluginToolErr }) => unknown) {
  return toFrameworkTool(
    $PluginTool.parse({ approval: null, description: 'Does something.', execute, parameters: z.object({}) })
  );
}

describe('toFrameworkTool', () => {
  it('drops a stated null approval, leaving presence as the gate', () => {
    expect(wrap(() => 'done')).not.toHaveProperty('approval');
  });

  it('keeps a declared approval renderer', async () => {
    const tool = toFrameworkTool(
      $PluginTool.parse({
        approval: () => ({ body: 'do it', presentation: 'verbatim' }),
        description: 'Does something.',
        execute: () => 'ok',
        parameters: z.object({})
      })
    );
    expect(await tool.approval?.({}, {})).toStrictEqual({ body: 'do it', presentation: 'verbatim' });
  });

  it('wraps a returned string as the tool output text', async () => {
    const tool = wrap(() => 'done');
    expect((await tool.execute({}, CONTEXT)).unwrap()).toStrictEqual({ text: 'done' });
  });

  it('passes a returned disclosure through', async () => {
    const output = { disclosure: { body: 'b', description: 'd', reference: 'r' }, text: 'saved' };
    const tool = wrap(() => output);
    expect((await tool.execute({}, CONTEXT)).unwrap()).toStrictEqual(output);
  });

  it('maps err.invalidArguments into the taxonomy and the turn continues', async () => {
    const tool = wrap((_args, { err }) => err.invalidArguments('bad ref'));
    const result = await tool.execute({}, CONTEXT);
    expect(result.error).toStrictEqual({ kind: 'invalid-arguments', message: 'bad ref' });
  });

  it('maps err.unresolved into the taxonomy', async () => {
    const tool = wrap((_args, { err }) => err.unresolved('maybe sent'));
    const result = await tool.execute({}, CONTEXT);
    expect(result.error).toStrictEqual({ kind: 'unresolved', message: 'maybe sent' });
  });

  it('lets any other throw propagate to the executor', async () => {
    const tool = wrap(() => {
      throw new Error('boom');
    });
    await expect(tool.execute({}, CONTEXT)).rejects.toThrow('boom');
  });
});
