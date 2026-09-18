import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BUILTIN_SKILL_NAMES } from '@collegium/core/skills';
import type { ToolId } from '@collegium/core/tools';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { SkillsService } from '../skills.service.ts';

const PLUGIN_SKILL = ['---', 'description: How to bookmark.', 'title: Saving bookmarks', '---', 'The body.'];
const PLUGIN_REFERENCE = ['---', 'description: How to name one.', 'title: Identifier style', '---', 'Keep it short.'];

let skillsDirectory: string;

const writeSkill = (relativePath: string, lines: string[]): void => {
  const filepath = path.join(skillsDirectory, relativePath);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, lines.join('\n'));
};

beforeEach(() => {
  skillsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-plugin-skills-'));
  writeSkill('saving-bookmarks/SKILL.md', PLUGIN_SKILL);
});

afterEach(() => {
  fs.rmSync(skillsDirectory, { force: true, recursive: true });
});

const GRANTED = buildAgentProfile({ skills: ['bookmark::saving-bookmarks'], username: 'mira' });

async function buildService(profiles: AgentProfile[]): Promise<SkillsService> {
  const agentRegistry = MockFactory.createMock(AgentRegistry);
  agentRegistry.list.mockReturnValue(profiles);
  agentRegistry.get.mockImplementation((username: string) => {
    return username === GRANTED.username ? GRANTED : buildAgentProfile({ username });
  });
  const pluginsRegistry = {
    skillSources: [{ directory: skillsDirectory, names: ['saving-bookmarks'], namespace: 'bookmark' }],
    toolsets: []
  };
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
      expect(skillsService.getDocument('mira', name).success).toBe(true);
    }
  });

  describe('getDocument', () => {
    it('should render the body under its title', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'handing-work-to-a-peer').unwrap()).toMatch(
        /^# Handing work to a peer\n\nYour system/
      );
    });

    it('should serve a plugin skill under its qualified `ns::skill` name (§3.5)', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'bookmark::saving-bookmarks').unwrap()).toBe(
        '# Saving bookmarks\n\nThe body.'
      );
    });

    it('should refuse an unknown name as the model’s recoverable mistake', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'missing').error?.message).toBe(
        'no skill named "missing" is in your manifest'
      );
    });

    it('should refuse a skill the agent was never assigned, as if it did not exist (§3.5)', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('vera', 'bookmark::saving-bookmarks').error?.message).toBe(
        'no skill named "bookmark::saving-bookmarks" is in your manifest'
      );
    });

    it('should serve a core skill to an agent granted nothing', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('vera', 'handing-work-to-a-peer').success).toBe(true);
    });
  });

  describe('getDocument references', () => {
    beforeEach(() => {
      writeSkill('saving-bookmarks/references/identifier-style.md', PLUGIN_REFERENCE);
    });

    it('should append the generated index beneath the skill body', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'bookmark::saving-bookmarks').unwrap()).toBe(
        [
          '# Saving bookmarks',
          'The body.',
          '## References',
          'Load one with skills__load, naming this skill and the reference.',
          '- identifier-style: How to name one.'
        ].join('\n\n')
      );
    });

    it('should serve a reference under its own title', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'bookmark::saving-bookmarks', 'identifier-style').unwrap()).toBe(
        '# Identifier style\n\nKeep it short.'
      );
    });

    it('should refuse an unknown reference without enumerating the ones it has (§7.1)', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'bookmark::saving-bookmarks', 'pricing').error?.message).toBe(
        'skill "bookmark::saving-bookmarks" lists no reference "pricing"'
      );
    });

    it('should refuse a reference of a skill that has none', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.getDocument('mira', 'handing-work-to-a-peer', 'pricing').error?.message).toBe(
        'skill "handing-work-to-a-peer" lists no reference "pricing"'
      );
    });
  });

  describe('listFor', () => {
    it('should list the core skills, then the grants, each with its description', async () => {
      const skillsService = await buildService([]);
      expect(skillsService.listFor(GRANTED)).toStrictEqual([
        {
          description: 'How to hand a task to another agent so it arrives with everything that agent needs to act.',
          name: 'handing-work-to-a-peer'
        },
        {
          description:
            'What Collegium is and who controls what. Use when a person asks what you are, how you are governed, why a turn stopped or an action was refused, or what a /collegium command does.',
          name: 'understanding-collegium'
        },
        { description: 'How to bookmark.', name: 'bookmark::saving-bookmarks' }
      ]);
    });
  });

  describe('renderManifest', () => {
    it('should carry the core skills for every agent, then its grants (§3.5)', async () => {
      const skillsService = await buildService([]);
      const manifest = skillsService.renderManifest(buildAgentProfile({ skills: ['bookmark::saving-bookmarks'] }));
      expect(manifest.split('\n')).toStrictEqual([
        '- handing-work-to-a-peer: How to hand a task to another agent so it arrives with everything that agent needs to act.',
        '- understanding-collegium: What Collegium is and who controls what. Use when a person asks what you are, how you are governed, why a turn stopped or an action was refused, or what a /collegium command does.',
        '- bookmark::saving-bookmarks: How to bookmark.'
      ]);
    });

    it('should still carry the core skills for an agent granted nothing', async () => {
      const skillsService = await buildService([]);
      const manifest = skillsService.renderManifest(buildAgentProfile());
      expect(manifest).toContain('- handing-work-to-a-peer:');
      expect(manifest).toContain('- understanding-collegium:');
    });
  });

  describe('assertGrantedToolsCoverSkills', () => {
    const writeSkillRequiring = (tools: string): void => {
      writeSkill('saving-bookmarks/SKILL.md', [
        '---',
        'description: How to bookmark.',
        'title: Saving bookmarks',
        `tools: ${tools}`,
        '---',
        'The body.'
      ]);
    };

    const held = (...ids: readonly ToolId[]) => new Map([[GRANTED.username, ids]]);

    it('should refuse an agent granted a skill that calls a tool it does not hold (§3.5)', async () => {
      writeSkillRequiring('[mail::send]');
      const skillsService = await buildService([GRANTED]);
      expect(() => skillsService.assertGrantedToolsCoverSkills(held(['memory', 'write']))).toThrow(
        'agent "mira" is granted the skill "bookmark::saving-bookmarks", which calls "mail::send", but holds no such tool'
      );
    });

    it('should accept a ref the agent holds and a namespace one of its tools is in', async () => {
      writeSkillRequiring('[mail::send, memory]');
      const skillsService = await buildService([GRANTED]);
      expect(() => {
        return skillsService.assertGrantedToolsCoverSkills(held(['mail', 'send'], ['memory', 'write']));
      }).not.toThrow();
    });

    it('should refuse a namespace the agent holds no tool in', async () => {
      writeSkillRequiring('[mail]');
      const skillsService = await buildService([GRANTED]);
      expect(() => skillsService.assertGrantedToolsCoverSkills(held(['memory', 'write']))).toThrow(
        'which calls "mail", but holds no such tool'
      );
    });

    it('should check nothing for a skill that declares nothing', async () => {
      const skillsService = await buildService([GRANTED]);
      expect(() => skillsService.assertGrantedToolsCoverSkills(new Map())).not.toThrow();
    });
  });

  describe('grants', () => {
    it('should refuse construction for a grant no library skill declares', async () => {
      await expect(buildService([buildAgentProfile({ skills: ['missing'] })])).rejects.toThrow(
        'no skill in the library declares'
      );
    });

    it('should refuse a core skill named in config (§3.5)', async () => {
      await expect(buildService([buildAgentProfile({ skills: ['handing-work-to-a-peer'] })])).rejects.toThrow(
        'core skill — always assigned and never granted'
      );
    });
  });
});
