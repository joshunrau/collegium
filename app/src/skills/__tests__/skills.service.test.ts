import { BUILTIN_SKILL_NAMES } from '@collegium/core/skills';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { SkillsService } from '../skills.service.ts';

const pluginSkill = { body: 'The body.', description: 'How to bookmark.', title: 'Saving bookmarks' };

async function buildService(profiles: AgentProfile[]): Promise<SkillsService> {
  const agentRegistry = MockFactory.createMock(AgentRegistry);
  agentRegistry.list.mockReturnValue(profiles);
  const pluginsRegistry = { skills: new Map([['bookmark::saving-bookmarks', pluginSkill]]), toolsets: [] };
  const moduleRef = await Test.createTestingModule({
    providers: [
      SkillsService,
      { provide: AgentRegistry, useValue: agentRegistry },
      { provide: PluginsRegistry, useValue: pluginsRegistry }
    ]
  }).compile();
  return moduleRef.get(SkillsService);
}

describe('SkillsService', () => {
  it('should load a document for every declared skill', async () => {
    const skillsService = await buildService([]);
    for (const name of BUILTIN_SKILL_NAMES) {
      expect(skillsService.getDocument(name).success).toBe(true);
    }
  });

  describe('getDocument', () => {
    it('should render the body under its title', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('handing-work-to-a-peer').unwrap()).toMatch(
        /^# Handing work to a peer\n\nYour system/
      );
    });

    it('should serve a plugin skill under its qualified `ns::skill` name (§9)', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('bookmark::saving-bookmarks').unwrap()).toBe('# Saving bookmarks\n\nThe body.');
    });

    it('should refuse an unknown name as the model’s recoverable mistake', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('missing').error?.message).toContain('no skill named "missing" exists');
    });
  });

  describe('renderManifest', () => {
    it('should carry the core skill for every agent, then its grants (§9)', async () => {
      const skillsService = await buildService([]);
      const manifest = skillsService.renderManifest(buildAgentProfile({ skills: ['bookmark::saving-bookmarks'] }));
      expect(manifest.split('\n')).toStrictEqual([
        '- handing-work-to-a-peer: How to hand a task to another agent so it arrives with everything that agent needs to act.',
        '- bookmark::saving-bookmarks: How to bookmark.'
      ]);
    });

    it('should still carry the core skill for an agent granted nothing', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.renderManifest(buildAgentProfile())).toContain('- handing-work-to-a-peer:');
    });
  });

  describe('grants', () => {
    it('should refuse construction for a grant no library skill declares', async () => {
      await expect(buildService([buildAgentProfile({ skills: ['missing'] })])).rejects.toThrow(
        'no skill in the library declares'
      );
    });

    it('should refuse a core skill named in config (§9)', async () => {
      await expect(buildService([buildAgentProfile({ skills: ['handing-work-to-a-peer'] })])).rejects.toThrow(
        'core skill — always assigned and never granted'
      );
    });
  });
});
