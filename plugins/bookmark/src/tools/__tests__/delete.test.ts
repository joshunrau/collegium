import { createTestContext, PluginToolFailureError } from '@collegium/sdk/testing';
import { describe, expect, it } from 'vitest';

import config from '../../config.ts';
import deleteBookmark from '../delete.ts';
import save from '../save.ts';

describe('bookmark::delete', () => {
  it('shows the approver the stored address, not only the identifier the model named', async () => {
    const context = createTestContext(config);
    await save.execute({ id: 'spec', url: 'https://example.com/spec' }, context);
    expect(await deleteBookmark.approval?.({ id: 'spec' }, context)).toStrictEqual({
      body: 'delete bookmark "spec" → https://example.com/spec',
      presentation: 'verbatim'
    });
    expect((await deleteBookmark.approval?.({ id: 'ghost' }, context))?.body).toBe(
      'delete bookmark "ghost", which is not saved'
    );
  });

  it('deletes a saved bookmark and refuses one that is not saved', async () => {
    const context = createTestContext(config);
    await save.execute({ id: 'spec', url: 'https://example.com/spec' }, context);
    expect(await deleteBookmark.execute({ id: 'spec' }, context)).toBe('bookmark spec deleted');
    await expect(deleteBookmark.execute({ id: 'spec' }, context)).rejects.toThrow(PluginToolFailureError);
  });
});
