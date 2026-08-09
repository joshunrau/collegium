import { describe, expect, it } from 'vitest';

import { toQualifiedName } from '../plugins.utils.ts';

describe('toQualifiedName', () => {
  it('joins the plugin and capability names with the separator', () => {
    expect(toQualifiedName('bookmark', 'save')).toBe('bookmark__save');
  });
});
