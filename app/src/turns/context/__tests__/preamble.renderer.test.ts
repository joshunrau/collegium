import { describe, expect, it } from 'vitest';

import { renderPreamble } from '../preamble.renderer.ts';

describe('renderPreamble', () => {
  it('should state the configured budget and the calls exempt from it', () => {
    const preamble = renderPreamble({ actionBudget: 7, budgetExemptToolNames: ['builtins__now', 'skills__load'] });
    expect(preamble).toContain('Each turn has a budget of 7 tool calls.');
    expect(preamble).toContain('Calls to builtins__now and skills__load do not.');
  });

  it('should leave the exemption sentence out when nothing is exempt', () => {
    const preamble = renderPreamble({ actionBudget: 10, budgetExemptToolNames: [] });
    expect(preamble).toContain('A denied call also uses the budget. When the budget is used');
    expect(preamble).not.toContain('Calls to');
  });
});
