import { describe, expect, it } from 'vitest';

import { renderApprovalContext } from '../approval-context.renderer.ts';

describe('renderApprovalContext', () => {
  it('should name the human who asked and quote their words (§3.7)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 7,
        requestedBy: { message: 'pull the deploy script\nand run it', username: 'joshua' }
      })
    ).toBe('Action 7 of 25 · requested by @joshua: "pull the deploy script and run it"');
  });

  it('should bound the excerpt at 140 characters (§3.7)', () => {
    const line = renderApprovalContext({
      actionBudget: 25,
      actionNumber: 1,
      requestedBy: { message: 'x'.repeat(200), username: 'joshua' }
    });
    expect(line).toBe(`Action 1 of 25 · requested by @joshua: "${'x'.repeat(140)}…"`);
  });

  it('should say a trigger raised the turn rather than repeating text written elsewhere (§3.7)', () => {
    expect(renderApprovalContext({ actionBudget: 25, actionNumber: 4, requestedBy: undefined })).toBe(
      'Action 4 of 25 · raised by a trigger'
    );
  });
});
