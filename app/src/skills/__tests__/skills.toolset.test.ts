import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { SkillsService } from '../skills.service.ts';
import { SKILLS_TOOLSET } from '../skills.toolset.ts';

const { load } = SKILLS_TOOLSET.tools;

function buildContext() {
  const skills = MockFactory.createMock(SkillsService);
  const context = { skills, turn: buildToolTurnScope() };
  return { context, skills };
}

describe('SKILLS_TOOLSET', () => {
  it('loads the named skill document', async () => {
    const { context, skills } = buildContext();
    skills.getDocument.mockReturnValue(Result.ok('# Handing Work To A Peer\n\nMention them once.'));
    const result = await executeTool(load, { name: 'handing-work-to-a-peer' }, context);
    expect(skills.getDocument).toHaveBeenCalledWith('handing-work-to-a-peer');
    expect(result.unwrap().text).toContain('# Handing Work To A Peer');
  });

  it('returns an unknown name to the model as its own recoverable mistake', async () => {
    const { context, skills } = buildContext();
    skills.getDocument.mockReturnValue(Result.err({ message: 'no skill named "nope" exists' }));
    const result = await executeTool(load, { name: 'nope' }, context);
    expect(result.error).toStrictEqual({ kind: 'invalid-arguments', message: 'no skill named "nope" exists' });
  });

  it('is budget-exempt and retryable (§5.3, §7.2)', () => {
    expect(load.budgetExempt).toBe(true);
    expect(load.retryable).toBe(true);
  });
});
