import { describe, expect, it } from 'vitest';

import { defineToolset, fail, ok, z } from '../index.ts';

describe('defineToolset', () => {
  it('returns the declaration inert, ready for the load perimeter', () => {
    const toolset = defineToolset({
      name: 'contacts',
      tools: {
        find: {
          description: 'Find a contact.',
          execute: () => ok('found nobody'),
          parameters: z.object({ query: z.string() })
        }
      }
    });
    expect(toolset.name).toBe('contacts');
    expect(Object.keys(toolset.tools)).toStrictEqual(['find']);
  });

  it('refuses a name outside the segment grammar', () => {
    expect(() => defineToolset({ name: 'Contacts', tools: {} })).toThrow('toolset namespace');
  });
});

describe('results', () => {
  it('wraps text and failures in the shapes the framework consumes', () => {
    expect(ok('done').unwrap()).toStrictEqual({ text: 'done' });
    expect(fail.invalidArguments('bad ref').error).toStrictEqual({ kind: 'invalid-arguments', message: 'bad ref' });
    expect(fail.exception('boom').error).toStrictEqual({ kind: 'exception', message: 'boom' });
    expect(fail.unresolved('maybe sent').error).toStrictEqual({ kind: 'unresolved', message: 'maybe sent' });
  });
});
