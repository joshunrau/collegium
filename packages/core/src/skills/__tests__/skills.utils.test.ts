import { describe, expect, it } from 'vitest';

import { parseQualifiedSkillName, renderQualifiedSkillName } from '../skills.utils.ts';

describe('parseQualifiedSkillName', () => {
  it('should invert renderQualifiedSkillName', () => {
    expect(parseQualifiedSkillName(renderQualifiedSkillName('mail', 'triage'))).toStrictEqual({
      namespace: 'mail',
      skillName: 'triage'
    });
  });

  it('should leave a framework skill without a namespace', () => {
    expect(parseQualifiedSkillName('handing-work-to-a-peer')).toStrictEqual({
      namespace: undefined,
      skillName: 'handing-work-to-a-peer'
    });
  });
});
