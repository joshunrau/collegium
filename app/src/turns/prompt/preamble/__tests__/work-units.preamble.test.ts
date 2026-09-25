import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderWorkUnitsPreamble } from '../work-units.preamble.ts';

describe('renderWorkUnitsPreamble', () => {
  it('should describe the Open work section and its absence only for an agent holding a tasks tool (§3.15)', () => {
    expect(renderWorkUnitsPreamble(buildStablePromptInput())).toBeUndefined();
    expect(
      renderWorkUnitsPreamble(buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'read'] }] }))
    ).toContain(
      'listed under Open work with their references, oldest first, and that section says so when none is open'
    );
  });

  it('should name tasks__read only to an agent granted it (§3.4)', () => {
    const assigning = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'assign'] }] });
    expect(renderWorkUnitsPreamble(assigning)).not.toContain('tasks__read');
    const reading = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'read'] }] });
    expect(renderWorkUnitsPreamble(reading)).toContain('tasks__read reads one by its reference');
  });

  it('should name the declared assignees only to an agent that assigns (§3.15)', () => {
    const assignees = [
      { displayName: 'Owen', username: 'owen' },
      { displayName: 'Tess', username: 'tess' }
    ];
    const declared =
      'tasks__assign hands a unit only to Owen (@owen) and Tess (@tess), and refuses any other colleague';
    const assigning = buildStablePromptInput({ assignees, granted: [{ gates: false, id: ['tasks', 'assign'] }] });
    expect(renderWorkUnitsPreamble(assigning)).toContain(declared);
    const reporting = buildStablePromptInput({ assignees, granted: [{ gates: false, id: ['tasks', 'report'] }] });
    expect(renderWorkUnitsPreamble(reporting)).not.toContain('tasks__assign hands');
  });
});
