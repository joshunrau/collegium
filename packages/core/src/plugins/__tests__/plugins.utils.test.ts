import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { $PluginTool, toFrameworkTool } from '../../plugins.ts';

import type { PluginToolHandles } from '../../plugins.ts';

const CONTEXT = {} as never;

function wrap(execute: (args: unknown, context: PluginToolHandles) => unknown) {
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

  it('binds the work-unit reader to the calling turn and hides the lookup behind it (§3.14)', async () => {
    const findWorkUnitView = vi.fn().mockResolvedValue(null);
    const tool = wrap(async (_args, context) => {
      expect(context).not.toHaveProperty('workUnitLookup');
      await context.workUnits.find('q3m8v1zd');
      return 'read';
    });
    await tool.execute({}, {
      turn: { agentUsername: 'mira', channelId: 'channel-1' },
      workUnitLookup: { findWorkUnitView }
    } as never);
    expect(findWorkUnitView).toHaveBeenCalledWith({
      agentUsername: 'mira',
      channelId: 'channel-1',
      reference: 'q3m8v1zd'
    });
  });

  it('lets any other throw propagate to the executor', async () => {
    const tool = wrap(() => {
      throw new Error('boom');
    });
    await expect(tool.execute({}, CONTEXT)).rejects.toThrow('boom');
  });
});
