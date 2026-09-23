import { describe, expect, it } from 'vitest';

import { renderApprovalContext } from '../approval-context.renderer.ts';

describe('renderApprovalContext', () => {
  it('should name the human who asked and quote their words (§3.7)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 7,
        requestedBy: { kind: 'human', message: 'pull the deploy script\nand run it', username: 'joshua' }
      })
    ).toBe('Action 7 of 25 · requested by @joshua: "pull the deploy script and run it"');
  });

  it('should bound the excerpt at 140 characters (§3.7)', () => {
    const line = renderApprovalContext({
      actionBudget: 25,
      actionNumber: 1,
      requestedBy: { kind: 'human', message: 'x'.repeat(200), username: 'joshua' }
    });
    expect(line).toBe(`Action 1 of 25 · requested by @joshua: "${'x'.repeat(140)}…"`);
  });

  it('should name a colleague that asked without mentioning it (§3.7, §4.5)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 4,
        requestedBy: { kind: 'agent', onBehalfOf: undefined, username: 'owen' }
      })
    ).toBe('Action 4 of 25 · asked by colleague owen');
  });

  it('should name the person whose request a colleague relays, quoting their words (§3.7)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 200,
        actionNumber: 5,
        requestedBy: {
          kind: 'agent',
          onBehalfOf: { kind: 'human', message: 'owen please ask mira to clear the scratch dir', username: 'joshua' },
          username: 'owen'
        }
      })
    ).toBe('Action 5 of 200 · asked by colleague owen, for @joshua: "owen please ask mira to clear the scratch dir"');
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 1,
        requestedBy: { kind: 'agent', onBehalfOf: { kind: 'system' }, username: 'owen' }
      })
    ).toBe('Action 1 of 25 · asked by colleague owen, on an item a trigger raised');
  });

  it('should name the trigger that raised the turn and say no person asked (§3.7)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 200,
        actionNumber: 7,
        requestedBy: { kind: 'system', trigger: { reference: '1:12', source: 'mail' } }
      })
    ).toBe('Action 7 of 200 · raised by a mail trigger (⟨1:12⟩), not by a person');
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 1,
        requestedBy: { kind: 'system', trigger: { reference: undefined, source: 'webhook' } }
      })
    ).toBe('Action 1 of 25 · raised by a webhook trigger, not by a person');
  });

  it('should name a schedule as the operator’s, whose text is an instruction (§3.7, §4.2)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 25,
        actionNumber: 1,
        requestedBy: { kind: 'system', trigger: { reference: 'morning-sweep', source: 'cron' } }
      })
    ).toBe('Action 1 of 25 · on the operator’s schedule (⟨morning-sweep⟩)');
  });

  it('should name the reasoned denial a re-requested call follows (§3.7)', () => {
    expect(
      renderApprovalContext({
        actionBudget: 200,
        actionNumber: 2,
        follows: { byUsername: 'joshua', reason: 'Use the name summary.txt instead.', toolName: 'workspace::write' },
        requestedBy: { kind: 'human', message: 'create a file report.txt', username: 'joshua' }
      })
    ).toBe(
      'Action 2 of 200 · requested by @joshua: "create a file report.txt" · after @joshua denied workspace::write: "Use the name summary.txt instead."'
    );
  });

  it('should say a trigger raised the turn rather than repeating text written elsewhere (§3.7)', () => {
    expect(renderApprovalContext({ actionBudget: 25, actionNumber: 4, requestedBy: undefined })).toBe(
      'Action 4 of 25 · raised by a trigger, not by a person'
    );
  });
});
