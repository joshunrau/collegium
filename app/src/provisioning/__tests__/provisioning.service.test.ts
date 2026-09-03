import type { AgentDefinition } from '@collegium/config';
import type { $MailSettings } from '@collegium/core/toolsets';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

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

const ADMIN = { email: 'ops@example.org', kind: 'password', password: 'secret', username: 'ops' } as const;

const agent = (username: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  contextBudgetTokens: 8000,
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: `You are ${username}`,
  tools: [],
  toolSettings: {},
  username,
  ...overrides
});

/** jane alone holds a mailbox, and its announcement channel is also a declared one */
const MAIL_SETTINGS: $MailSettings = {
  announcementChannel: 'arrivals',
  pollIntervalMs: 60_000,
  provider: {
    address: 'jane@example.org',
    clientId: 'client_1',
    clientSecret: 'secret_1',
    kind: 'exchange',
    tenantId: 'tenant_1'
  }
};

describe('ProvisioningService', () => {
  let adminClient: MockedInstance<MattermostAdminClient>;
  let credentialsService: MockedInstance<CredentialsService>;
  let provisioningService: ProvisioningService;

  beforeEach(async () => {
    adminClient = MockFactory.createMock(MattermostAdminClient);
    adminClient.ensureTeam.mockResolvedValue('team-1');
    adminClient.ensureChannel.mockImplementation(({ handle }: { handle: string }) => Promise.resolve(`id-${handle}`));
    adminClient.ensureBot.mockImplementation(({ username }: { username: string }) => {
      return Promise.resolve(`user-${username}`);
    });
    adminClient.mintAccessToken.mockResolvedValue('minted');
    credentialsService = MockFactory.createMock(CredentialsService);
    credentialsService.ensure.mockImplementation(({ mint }) => mint());

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: MattermostAdminClient, useValue: adminClient },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({
            agents: {
              amir: agent('amir'),
              jane: agent('jane', { tools: ['mail'], toolSettings: { mail: MAIL_SETTINGS } })
            },
            mattermost: {
              channels: {
                arrivals: { triggeringMode: 'respond-to-all' },
                research: { triggeringMode: 'mention-required' }
              }
            }
          })
        },
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

  it('should refuse a server whose settings cannot carry the deployment before creating anything', () => {
    expect(adminClient.authenticate).toHaveBeenCalledBefore(adminClient.assertServerSupportsDeployment);
    expect(adminClient.assertServerSupportsDeployment).toHaveBeenCalledBefore(adminClient.ensureTeam);
    expect(adminClient.assertServerSupportsDeployment).toHaveBeenCalledExactlyOnceWith({
      publicUrl: 'http://localhost:3000'
    });
  });

  it('should provision the system bot and one account per declared agent', () => {
    expect(adminClient.ensureBot.mock.calls.map(([{ username }]) => username)).toStrictEqual([
      'orchestrator',
      'amir',
      'jane'
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
      'amir',
      'jane'
    ]);
  });

  const placedIn = (handle: string) => {
    return adminClient.ensureChannelMember.mock.calls
      .filter(([{ channelId }]) => channelId === `id-${handle}`)
      .map(([{ userId }]) => userId);
  };

  it('should add every bot to the main channel', () => {
    expect(placedIn('town-square')).toStrictEqual(['user-orchestrator', 'user-amir', 'user-jane']);
  });

  it('should place the system bot alone in every other declared channel', () => {
    expect(placedIn('research')).toStrictEqual(['user-orchestrator']);
  });

  it('should place a mailbox owner in the channel its arrivals are announced to', () => {
    expect(placedIn('arrivals')).toStrictEqual(['user-orchestrator', 'user-jane']);
  });

  it('should provision a channel once when it is both declared and announced to', () => {
    expect(adminClient.ensureChannel.mock.calls.filter(([{ handle }]) => handle === 'arrivals')).toHaveLength(1);
  });
});
