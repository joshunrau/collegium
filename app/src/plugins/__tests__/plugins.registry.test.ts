import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PluginsRegistry } from '../plugins.registry.ts';

import type { LoadedPlugin } from '../plugins.types.ts';

function buildLoadedPlugin(name = 'bookmark'): LoadedPlugin {
  return {
    skills: { 'saving-bookmarks': { body: 'The body.', description: 'How to bookmark.', title: 'Saving bookmarks' } },
    toolset: {
      name,
      skills: ['saving-bookmarks'],
      tools: {
        save: {
          description: 'Saves a bookmark.',
          execute: () => Result.ok({ text: 'saved' }),
          parameters: z.object({})
        }
      }
    }
  };
}

describe('PluginsRegistry', () => {
  it('exposes each plugin as a toolset', () => {
    const registry = new PluginsRegistry([buildLoadedPlugin()]);
    expect(registry.toolsets.map((toolset) => toolset.name)).toStrictEqual(['bookmark']);
  });

  it('exposes plugin skills under their qualified names (§9)', () => {
    const registry = new PluginsRegistry([buildLoadedPlugin()]);
    expect(registry.skills.get('bookmark::saving-bookmarks')?.title).toBe('Saving bookmarks');
  });

  it('refuses a plugin claiming a framework namespace (§1)', () => {
    expect(() => new PluginsRegistry([buildLoadedPlugin('mail')])).toThrow(
      'plugin namespace "mail" is reserved by the framework'
    );
    expect(() => new PluginsRegistry([buildLoadedPlugin('skills')])).toThrow('reserved by the framework');
  });
});
