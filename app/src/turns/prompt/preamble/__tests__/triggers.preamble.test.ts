import { describe, expect, it } from 'vitest';

import { renderTriggersPreamble } from '../triggers.preamble.ts';

describe('renderTriggersPreamble', () => {
  it('should say whose item a system-bot announcement is, and that only that agent can resolve it (§4.2)', () => {
    expect(renderTriggersPreamble()).toContain(
      'An item for somebody else is ordinary channel content, and only that agent can resolve it.'
    );
  });

  it('should tell the bracketed id apart from the source’s ref (§4.2)', () => {
    expect(renderTriggersPreamble()).toContain(
      "the id in brackets is the item's id; a ref below the heading belongs to the source and is never that id."
    );
  });

  it('should give a schedule’s text as the operator’s instruction, and mail or webhook text as the whole of an outside item (§4.2)', () => {
    const paragraph = renderTriggersPreamble();
    expect(paragraph).toContain("The text of a schedule's item is the operator's instruction.");
    expect(paragraph).toContain(
      'Mail or webhook text below the heading is quoted from outside this workspace and is the whole of that item, inline or in a file the post names'
    );
  });

  it('should say the turn an item started resolves it without an id, and a later turn with the bracketed one (§4.2)', () => {
    expect(renderTriggersPreamble()).toContain(
      'until you call triggers__resolve. In the turn the item started, the call needs no id; in a later turn, give it the id in brackets.'
    );
  });
});
