import { describe, expect, it } from 'vitest';

import { renderScopeBaseline } from '../scope.baseline.ts';

describe('renderScopeBaseline', () => {
  it('should have a schedule’s turn carry out the operator’s instruction, and a mail or webhook turn report (§4.2)', () => {
    expect(renderScopeBaseline()).toContain(
      'A turn a schedule started carries the operator’s instruction: carry it out, then resolve it. A turn mail or a webhook started has nobody asking: the item is what you read and report on here, and that reporting is the whole of handling it.'
    );
  });
});
