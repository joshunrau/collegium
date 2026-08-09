import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { RosterService } from '../../roster/roster.service.ts';
import { MultiMentionPolicy } from '../multi-mention.policy.ts';

const profile = (username: string): AgentProfile => ({ username }) as AgentProfile;

describe('MultiMentionPolicy', () => {
  let multiMentionPolicy: MultiMentionPolicy;

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([profile('mira'), profile('owen'), profile('tess')]);
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockImplementation((channelId) =>
      channelId === 'channel-dm' ? [profile('mira')] : [profile('mira'), profile('owen'), profile('tess')]
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        MultiMentionPolicy,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: RosterService, useValue: rosterService }
      ]
    }).compile();
    multiMentionPolicy = moduleRef.get(MultiMentionPolicy);
  });

  describe('refuses', () => {
    it('should refuse a post mentioning two agents present in the channel', () => {
      expect(
        multiMentionPolicy.refuses({
          authorUsername: 'casey',
          channelId: 'channel-1',
          mentionedUsernames: ['mira', 'owen']
        })
      ).toBe(true);
    });

    it('should treat mentions of absent agents as inert text', () => {
      expect(
        multiMentionPolicy.refuses({
          authorUsername: 'casey',
          channelId: 'channel-dm',
          mentionedUsernames: ['mira', 'owen']
        })
      ).toBe(false);
    });

    it('should not count the author naming itself', () => {
      expect(
        multiMentionPolicy.refuses({
          authorUsername: 'mira',
          channelId: 'channel-1',
          mentionedUsernames: ['mira', 'owen']
        })
      ).toBe(false);
    });

    it('should allow a post addressing a single agent', () => {
      expect(
        multiMentionPolicy.refuses({ authorUsername: 'casey', channelId: 'channel-1', mentionedUsernames: ['mira'] })
      ).toBe(false);
    });
  });

  describe('stripAgentMentions', () => {
    it('should strip agent mentions and leave human mentions alone', () => {
      expect(multiMentionPolicy.stripAgentMentions('asking @owen about what @casey said')).toBe(
        'asking owen about what @casey said'
      );
    });

    it.each(['.', ',', '!', '?', ')', ':', '-', '_'])(
      'should strip an agent mention terminated by "%s"',
      (terminator) => {
        expect(multiMentionPolicy.stripAgentMentions(`asking @owen${terminator} now`)).not.toContain('@owen');
      }
    );

    it.each(['@owenrose', '@owen-rose', '@owen.rose', '@owen_rose'])(
      'should leave "%s" alone, since it names someone else',
      (username) => {
        expect(multiMentionPolicy.stripAgentMentions(`asking ${username} now`)).toBe(`asking ${username} now`);
      }
    );
  });
});
