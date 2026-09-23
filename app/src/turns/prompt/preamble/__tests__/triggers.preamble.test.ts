import { describe, expect, it } from 'vitest';

import { renderTriggersPreamble } from '../triggers.preamble.ts';

describe('renderTriggersPreamble', () => {
  it('should say whose item a system-bot announcement is, and that its body is the whole of it (§4.2)', () => {
    const paragraph = renderTriggersPreamble();
    expect(paragraph).toContain(
      'An item for somebody else is ordinary channel content and its id is not yours to resolve.'
    );
    expect(paragraph).toContain('is the whole of that item, inline or in a file the post names');
  });
});
