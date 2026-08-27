import type { AgentDefinition } from '@collegium/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { MEMORY_TOOLSET } from '@/memory/memory.toolset.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';

import { AgentRegistry } from '../agents.registry.ts';

import type { AgentProfile } from '../agents.types.ts';

const MIRA: AgentDefinition = {
  contextBudgetTokens: 8000,
  expertise: 'code review',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: ['handing-work-to-a-peer'],
  systemPrompt: 'You are Mira',
  tools: ['memory'],
  toolSettings: { memory: { maxEntries: 5 } },
  username: 'mira'
};

const TESS: AgentDefinition = {
  contextBudgetTokens: 8000,
  expertise: 'scheduling',
  model: { name: 'deepseek-v4-pro', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Tess',
  tools: [],
  toolSettings: {},
  username: 'tess'
};

const post = createObservedPost;

describe('AgentRegistry', () => {
  let agentRegistry: AgentRegistry;
  let mira: AgentProfile;

  beforeEach(async () => {
    const configService = createConfigServiceMock({ agents: { mira: MIRA, tess: TESS } });
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentRegistry,
        { provide: ConfigService, useValue: configService },
        { provide: EnvService, useValue: createEnvServiceMock() },
        { provide: PluginsRegistry, useValue: new PluginsRegistry([]) }
      ]
    }).compile();
    agentRegistry = moduleRef.get(AgentRegistry);
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
      maxBodyChars: 4000,
      maxDescriptionChars: 200,
      maxEntries: 5
    });
    expect(agentRegistry.settingsFor(MEMORY_TOOLSET, 'tess')).toBeUndefined();
  });

  it('should report an unknown username as absent', () => {
    expect(agentRegistry.has('dana')).toBe(false);
    expect(agentRegistry.get('dana')).toBeUndefined();
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
