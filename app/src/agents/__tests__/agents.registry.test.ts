import type { AgentDefinition } from '@collegium/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { MEMORY_TOOLSET } from '@/memory/memory.toolset.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { ResourcesService } from '@/resources/resources.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';

import { AgentRegistry } from '../agents.registry.ts';

import type { AgentProfile } from '../agents.types.ts';

const MIRA: AgentDefinition = {
  actionBudget: 120,
  completionTimeLimitMs: 1_200_000,
  contextBudgetTokens: 8000,
  displayName: 'Mira Turner',
  expertise: 'code review',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  schedules: {},
  skills: ['handing-work-to-a-peer'],
  systemPrompt: 'You are Mira',
  tools: ['memory'],
  toolSettings: { memory: { maxEntries: 5 } },
  turnContextCeilingTokens: 200_000,
  username: 'mira'
};

const TESS: AgentDefinition = {
  completionTimeLimitMs: 1_200_000,
  contextBudgetTokens: 8000,
  displayName: 'Tess',
  expertise: 'scheduling',
  model: { name: 'deepseek-v4-pro', provider: 'deepseek' },
  schedules: {},
  skills: [],
  systemPrompt: 'You are Tess',
  tools: [],
  toolSettings: {},
  turnContextCeilingTokens: 200_000,
  username: 'tess'
};

const post = createObservedPost;

const buildRegistry = async (
  agents: { [key: string]: AgentDefinition },
  resourcesService = MockFactory.createMock(ResourcesService)
): Promise<AgentRegistry> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AgentRegistry,
      { provide: ConfigService, useValue: createConfigServiceMock({ agents }) },
      { provide: EnvService, useValue: createEnvServiceMock() },
      { provide: PluginsRegistry, useValue: new PluginsRegistry([]) },
      { provide: ResourcesService, useValue: resourcesService }
    ]
  }).compile();
  return moduleRef.get(AgentRegistry);
};

describe('AgentRegistry', () => {
  let agentRegistry: AgentRegistry;
  let mira: AgentProfile;

  beforeEach(async () => {
    agentRegistry = await buildRegistry({ mira: MIRA, tess: TESS });
    mira = agentRegistry.get('mira')!;
  });

  it('should build one profile per configured agent', () => {
    expect(agentRegistry.list().map((profile) => profile.username)).toStrictEqual(['mira', 'tess']);
  });

  it('should not carry the bot token onto the profile', () => {
    expect(mira).not.toHaveProperty('botToken');
  });

  it('should resolve effective tool settings per granted toolset, typed by its schema (§8)', () => {
    expect(agentRegistry.settingsFor(MEMORY_TOOLSET, 'mira')).toStrictEqual({
      maxBodyChars: 16_000,
      maxDescriptionChars: 200,
      maxEntries: 5
    });
    expect(agentRegistry.settingsFor(MEMORY_TOOLSET, 'tess')).toBeUndefined();
  });

  it('should give an agent the action budget it states, and the deployment’s to one that does not (§5.3)', () => {
    expect(mira.actionBudget).toBe(120);
    expect(agentRegistry.get('tess')?.actionBudget).toBe(25);
  });

  it('should name an agent by its display name, and one config no longer declares by its username capitalised (§3.1)', () => {
    expect(agentRegistry.displayNameOf('mira')).toBe('Mira Turner');
    expect(agentRegistry.displayNameOf('dana')).toBe('Dana');
  });

  it('should report an unknown username as absent', () => {
    expect(agentRegistry.has('dana')).toBe(false);
    expect(agentRegistry.get('dana')).toBeUndefined();
  });

  describe('systemPrompt', () => {
    it('should keep an inline prompt as written (§3.1)', () => {
      expect(mira.systemPrompt).toBe('You are Mira');
    });

    it('should read a prompt named as a resource, trimmed (§3.1)', async () => {
      const resourcesService = MockFactory.createMock(ResourcesService);
      resourcesService.readText.mockReturnValue('You are Mira, at length.\n\n');
      const registry = await buildRegistry(
        { mira: { ...MIRA, systemPrompt: { resource: 'prompts/mira.md' } } },
        resourcesService
      );
      expect(registry.get('mira')?.systemPrompt).toBe('You are Mira, at length.');
      expect(resourcesService.readText).toHaveBeenCalledWith('prompts/mira.md');
    });

    it('should refuse boot when the named resource is empty', async () => {
      const resourcesService = MockFactory.createMock(ResourcesService);
      resourcesService.readText.mockReturnValue('  \n');
      await expect(
        buildRegistry({ mira: { ...MIRA, systemPrompt: { resource: 'prompts/mira.md' } } }, resourcesService)
      ).rejects.toThrow('agent "mira" system prompt "prompts/mira.md" is empty');
    });
  });

  describe('isAddressedBy', () => {
    describe('mention-required', () => {
      it('should address an agent mentioned in a channel', () => {
        expect(agentRegistry.isAddressedBy(mira, post({ mentionedUsernames: ['mira'] }), 'mention-required')).toBe(
          true
        );
      });

      it('should not address an agent on an unmentioned human post', () => {
        expect(agentRegistry.isAddressedBy(mira, post(), 'mention-required')).toBe(false);
      });

      it('should not address an agent when only a peer is mentioned', () => {
        expect(agentRegistry.isAddressedBy(mira, post({ mentionedUsernames: ['tess'] }), 'mention-required')).toBe(
          false
        );
      });
    });

    describe('respond-to-all', () => {
      it('should address an agent on an unmentioned human post', () => {
        expect(agentRegistry.isAddressedBy(mira, post(), 'respond-to-all')).toBe(true);
      });

      it('should not address an agent on an unmentioned agent post, or it would reply to its own output', () => {
        expect(agentRegistry.isAddressedBy(mira, post({ authorKind: 'agent' }), 'respond-to-all')).toBe(false);
      });

      it('should not address an agent on an unmentioned system bot post', () => {
        expect(agentRegistry.isAddressedBy(mira, post({ authorKind: 'system' }), 'respond-to-all')).toBe(false);
      });

      it('should address an agent mentioned by an agent or the system bot', () => {
        const mentioned = { mentionedUsernames: ['mira'] };
        expect(agentRegistry.isAddressedBy(mira, post({ authorKind: 'agent', ...mentioned }), 'respond-to-all')).toBe(
          true
        );
        expect(agentRegistry.isAddressedBy(mira, post({ authorKind: 'system', ...mentioned }), 'respond-to-all')).toBe(
          true
        );
      });
    });
  });
});
