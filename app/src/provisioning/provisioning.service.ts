import type { AdminCredentials, AgentDefinition } from '@collegium/config';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { CredentialsService } from '@/credentials/credentials.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MAIL_TOOLSET } from '@/mail/mail.toolset.ts';
import { resolveGrantedToolsetSettings } from '@/tools/tools.settings.ts';

import { MattermostAdminClient } from './adapters/mattermost-admin.client.ts';
import { PROVISIONING_PING } from './provisioning.constants.ts';

/**
 * Brings Mattermost into line with what config.json declares, and is the only thing in the system
 * that creates an account or a channel. It runs to completion before the app starts, so that boot
 * stays what it is — a sequence of refusals against a world someone else built. A boot that verified
 * its own writes would verify nothing.
 *
 * Every step is idempotent: this runs on every start, against a server that usually already holds
 * everything it asks for.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly adminClient: MattermostAdminClient,
    private readonly configService: ConfigService,
    private readonly credentialsService: CredentialsService,
    private readonly envService: EnvService,
    private readonly loggingService: LoggingService
  ) {}

  async reconcile(credentials: AdminCredentials): Promise<void> {
    await this.adminClient.waitUntilReachable(PROVISIONING_PING);
    await this.adminClient.authenticate(credentials);
    await this.adminClient.assertServerSupportsDeployment({ publicUrl: this.envService.get('APP_PUBLIC_URL') });

    const teamName = this.envService.get('MATTERMOST_TEAM');
    const teamId = await this.adminClient.ensureTeam(teamName);
    this.loggingService.log(`provisioning team "${teamName}"`);

    const mattermost = this.configService.get('mattermost');
    const agents = Object.values(this.configService.get('agents'));

    const systemBotId = await this.provisionBot({ teamId, username: mattermost.systemBotUsername });
    // §8.4 — the system bot reconciles the team's slash commands at every boot, which needs the grant
    await this.adminClient.ensureTeamAdmin({ teamId, userId: systemBotId });

    const provisioned: { readonly agent: AgentDefinition; readonly userId: string }[] = [];
    for (const agent of agents) {
      provisioned.push({ agent, userId: await this.provisionBot({ teamId, username: agent.username }) });
    }

    const memberIdsByHandle = new Map<string, Set<string>>();
    const membersOf = (handle: string): Set<string> => {
      const memberIds = memberIdsByHandle.get(handle) ?? new Set([systemBotId]);
      memberIdsByHandle.set(handle, memberIds);
      return memberIds;
    };
    // §3.1 — a declared channel is still created: boot resolves every handle to an id and refuses one
    // that names nothing
    for (const handle of [mattermost.mainChannel, ...Object.keys(mattermost.channels)]) {
      membersOf(handle);
    }
    const defaultToolSettings = this.configService.get('agentDefaults.toolSettings');
    for (const { agent, userId } of provisioned) {
      membersOf(mattermost.mainChannel).add(userId);
      const mailSettings = resolveGrantedToolsetSettings(MAIL_TOOLSET, { agent, defaults: defaultToolSettings });
      if (mailSettings) {
        membersOf(mailSettings.announcementChannel).add(userId);
      }
    }
    for (const [handle, memberIds] of memberIdsByHandle) {
      await this.provisionChannel({ handle, memberIds: [...memberIds], teamId });
    }
  }

  /** the account, its team membership, and the token bound to it */
  private async provisionBot(params: { teamId: string; username: string }): Promise<string> {
    const userId = await this.adminClient.ensureBot(params);
    await this.credentialsService.ensure({
      mint: () => {
        this.loggingService.log(`minting an access token for "${params.username}"`);
        return this.adminClient.mintAccessToken(userId);
      },
      userId,
      username: params.username
    });
    return userId;
  }

  /** the channel, and the accounts provisioning is answerable for putting in it */
  private async provisionChannel(params: {
    handle: string;
    memberIds: readonly string[];
    teamId: string;
  }): Promise<void> {
    const channelId = await this.adminClient.ensureChannel({ handle: params.handle, teamId: params.teamId });
    for (const userId of params.memberIds) {
      await this.adminClient.ensureChannelMember({ channelId, userId });
    }
    this.loggingService.log(`provisioning channel "${params.handle}" with ${params.memberIds.length} member(s)`);
  }
}
