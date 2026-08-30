import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PluginsRegistry } from '../plugins.registry.ts';

import type { LoadedPlugin } from '../plugins.types.ts';

function buildLoadedPlugin(name = 'bookmark'): LoadedPlugin {
  return {
    skillsDirectory: '/srv/plugins/bookmark/src/skills',
    toolset: {
      name,
      skills: ['saving-bookmarks'],
      storage: {},
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

  it('reports where a plugin keeps its skill documents, under its namespace (§9)', () => {
    const registry = new PluginsRegistry([buildLoadedPlugin()]);
    expect(registry.skillSources).toStrictEqual([
      { directory: '/srv/plugins/bookmark/src/skills', names: ['saving-bookmarks'], namespace: 'bookmark' }
    ]);
  });

  it('refuses a plugin claiming a framework namespace (§1)', () => {
    expect(() => new PluginsRegistry([buildLoadedPlugin('mail')])).toThrow(
      'plugin namespace "mail" is reserved by the framework'
    );
    expect(() => new PluginsRegistry([buildLoadedPlugin('skills')])).toThrow('reserved by the framework');
  });
});
