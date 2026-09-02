import { createTestContext, PluginToolFailureError } from '@collegium/sdk/testing';
import { describe, expect, it } from 'vitest';

import config from '../../config.ts';
import list from '../list.ts';
import save from '../save.ts';

describe('bookmark::save', () => {
  it('saves a bookmark that list then reports under the limit', async () => {
    const context = createTestContext(config, { settings: { maxBookmarks: 5 } });
    expect(await save.execute({ id: 'spec', url: 'https://example.com/spec' }, context)).toBe('bookmark spec saved');
    expect(await list.execute({}, context)).toBe('1/5 bookmarks\n- spec: https://example.com/spec');
  });

  it('refuses a save past the limit', async () => {
    const context = createTestContext(config, { settings: { maxBookmarks: 1 } });
    await save.execute({ id: 'one', url: 'https://example.com/1' }, context);
    await expect(save.execute({ id: 'two', url: 'https://example.com/2' }, context)).rejects.toThrow(
      PluginToolFailureError
    );
  });
});
