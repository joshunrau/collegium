import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { SkillsService } from '@/skills/skills.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { LoadSkillTool } from '../load-skill.tool.ts';

describe('LoadSkillTool', () => {
  it('should return the document of the named skill', async () => {
    const skills = MockFactory.createMock(SkillsService);
    skills.getDocument.mockReturnValue(Result.ok('# Handing work to a peer\n\nThe body'));
    const moduleRef = await Test.createTestingModule({
      providers: [LoadSkillTool, { provide: SkillsService, useValue: skills }]
    }).compile();

    const result = await moduleRef.get(LoadSkillTool).execute({ name: 'handing-work-to-a-peer' });

    expect(skills.getDocument).toHaveBeenCalledWith('handing-work-to-a-peer');
    expect(result.value).toStrictEqual({ text: '# Handing work to a peer\n\nThe body' });
  });
});
