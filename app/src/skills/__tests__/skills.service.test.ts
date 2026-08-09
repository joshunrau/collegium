import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PluginsRegistry } from '@/plugins/plugins.registry.ts';

import { SKILL_NAMES } from '../skills.constants.ts';
import { SkillsService } from '../skills.service.ts';

const pluginSkill = { body: 'The body.', description: 'How to bookmark.', title: 'Saving bookmarks' };

describe('SkillsService', () => {
  let skillsService: SkillsService;

  beforeEach(async () => {
    const pluginsRegistry = { skills: new Map([['bookmark__saving-bookmarks', pluginSkill]]), tools: [] };
    const moduleRef = await Test.createTestingModule({
      providers: [SkillsService, { provide: PluginsRegistry, useValue: pluginsRegistry }]
    }).compile();
    skillsService = moduleRef.get(SkillsService);
  });

  it('should load a document for every declared skill', () => {
    for (const name of SKILL_NAMES) {
      expect(skillsService.getDocument(name).success).toBe(true);
    }
  });

  describe('getDocument', () => {
    it('should render the body under its title', () => {
      expect(skillsService.getDocument('handing-work-to-a-peer').unwrap()).toMatch(
        /^# Handing work to a peer\n\nYour system/
      );
    });

    it('should serve a plugin skill under its qualified name', () => {
      expect(skillsService.getDocument('bookmark__saving-bookmarks').unwrap()).toBe('# Saving bookmarks\n\nThe body.');
    });

    it('should refuse an unknown name as the model’s recoverable mistake', () => {
      expect(skillsService.getDocument('missing').error?.message).toContain('no skill named "missing" exists');
    });
  });

  describe('renderManifest', () => {
    it('should render one line per assigned skill', () => {
      expect(skillsService.renderManifest(['handing-work-to-a-peer'])).toBe(
        '- handing-work-to-a-peer: How to hand a task to another agent so it arrives with everything that agent needs to act.'
      );
    });

    it('should render nothing for an agent with no skills', () => {
      expect(skillsService.renderManifest([])).toBe('');
    });
  });

  describe('verifyGrants', () => {
    it('should throw for a grant no library skill declares', () => {
      const profile = { skills: ['missing'], username: 'mira' };
      expect(() => skillsService.verifyGrants([profile as never])).toThrow('no skill in the library declares');
    });
  });
});
