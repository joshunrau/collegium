import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { PluginsRegistry } from '../plugins.registry.ts';
import { PluginStorageService } from '../storage/plugin-storage.service.ts';

import type { LoadedPlugin } from '../plugins.types.ts';

/** the qualified name is baked by the SDK factory; core's Tool() with the pre-qualified name stands in for it */
class SaveTool extends Tool({
  description: 'Saves a bookmark.',
  name: 'bookmark__save',
  parameters: z.object({}),
  timeoutMs: 1000,
  variant: 'ungated'
}) {
  execute(): Tool.Result {
    return Result.ok({ text: 'saved' });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  isRetryable(): boolean {
    return true;
  }

  renderTraceDetail(): string {
    return 'save';
  }
}

function buildLoadedPlugin(): LoadedPlugin {
  return {
    manifest: {
      collections: { bookmarks: z.object({}) },
      name: 'bookmark',
      skills: ['saving-bookmarks'],
      tools: [SaveTool]
    },
    settings: undefined,
    skills: { 'saving-bookmarks': { body: 'The body.', description: 'How to bookmark.', title: 'Saving bookmarks' } }
  };
}

describe('PluginsRegistry', () => {
  const storageService = MockFactory.createMock(PluginStorageService);

  it('exposes plugin tools under their qualified names', () => {
    const registry = new PluginsRegistry([buildLoadedPlugin()], storageService);
    expect(registry.tools.map((tool) => tool.name)).toEqual(['bookmark__save']);
  });

  it('builds a storage handle per declared collection', () => {
    new PluginsRegistry([buildLoadedPlugin()], storageService);
    expect(storageService.collection).toHaveBeenCalledWith('bookmark', 'bookmarks', expect.anything());
  });

  it('exposes plugin skills under their qualified names', () => {
    const registry = new PluginsRegistry([buildLoadedPlugin()], storageService);
    expect(registry.skills.get('bookmark__saving-bookmarks')?.title).toBe('Saving bookmarks');
  });
});
