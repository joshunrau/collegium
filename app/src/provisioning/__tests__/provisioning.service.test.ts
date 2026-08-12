import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { $AgentDefinition } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { CredentialsService } from '@/credentials/credentials.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MattermostAdminClient } from '../adapters/mattermost-admin.client.ts';
import { ProvisioningService } from '../provisioning.service.ts';

const ADMIN = { email: 'ops@example.org', password: 'secret', username: 'ops' };

const agent = (username: string): $AgentDefinition => ({
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: `You are ${username}`,
  tools: [],
  username
});

describe('ProvisioningService', () => {
  let adminClient: MockedInstance<MattermostAdminClient>;
  let credentialsService: MockedInstance<CredentialsService>;
  let provisioningService: ProvisioningService;

  beforeEach(async () => {
    adminClient = MockFactory.createMock(MattermostAdminClient);
    adminClient.ensureTeam.mockResolvedValue('team-1');
    adminClient.ensureChannel.mockImplementation(({ handle }: { handle: string }) => Promise.resolve(`id-${handle}`));
    adminClient.ensureBot.mockImplementation(({ username }: { username: string }) =>
      Promise.resolve(`user-${username}`)
    );
    adminClient.mintAccessToken.mockResolvedValue('minted');
    credentialsService = MockFactory.createMock(CredentialsService);
    credentialsService.ensure.mockImplementation(({ mint }) => mint());

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: MattermostAdminClient, useValue: adminClient },
        { provide: ConfigService, useValue: createConfigServiceMock({ agents: [agent('jane'), agent('amir')] }) },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: EnvService, useValue: createEnvServiceMock() },
        MockFactory.createForService(LoggingService)
      ]
    }).compile();
    provisioningService = moduleRef.get(ProvisioningService);
    await provisioningService.reconcile(ADMIN);
  });

  it('should wait for Mattermost before authenticating', () => {
    expect(adminClient.waitUntilReachable).toHaveBeenCalledBefore(adminClient.authenticate);
    expect(adminClient.authenticate).toHaveBeenCalledWith(ADMIN);
  });

  it('should provision the system bot and one account per declared agent', () => {
    expect(adminClient.ensureBot.mock.calls.map(([{ username }]) => username)).toStrictEqual([
      'orchestrator',
      'jane',
      'amir'
    ]);
  });

  // §8.4 — the system bot reconciles the team's slash commands at every boot
  it('should grant the system bot alone authority over the team', () => {
    expect(adminClient.ensureTeamAdmin).toHaveBeenCalledExactlyOnceWith({
      teamId: 'team-1',
      userId: 'user-orchestrator'
    });
  });

  it('should keep a token for every account it provisions', () => {
    expect(credentialsService.ensure.mock.calls.map(([{ username }]) => username)).toStrictEqual([
      'orchestrator',
      'jane',
      'amir'
    ]);
  });

  it('should add every bot to the main channel', () => {
    const added = adminClient.ensureChannelMember.mock.calls
      .filter(([{ channelId }]) => channelId === 'id-town-square')
      .map(([{ userId }]) => userId);
    expect(added).toStrictEqual(['user-orchestrator', 'user-jane', 'user-amir']);
  });
});
