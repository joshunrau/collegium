import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { CredentialsService } from '@/credentials/credentials.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MAIL_TOOLSET } from '@/mail/mail.toolset.ts';
import { resolveGrantedToolsetSettings } from '@/tools/tools.settings.ts';

import { MattermostAdminClient } from './adapters/mattermost-admin.client.ts';
import { PROVISIONING_PING } from './provisioning.constants.ts';

import type { AdminCredentials } from './provisioning.types.ts';

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

    const teamName = this.envService.get('MATTERMOST_TEAM');
    const teamId = await this.adminClient.ensureTeam(teamName);
    this.loggingService.log(`provisioning team "${teamName}"`);

    const mattermost = this.configService.get('mattermost');
    const agents = Object.values(this.configService.get('agents'));

    // the main channel first: every bot must be a member, and town-square admits them on team join
    const mainChannelId = await this.adminClient.ensureChannel({ handle: mattermost.mainChannel, teamId });
    const declaredChannels = new Map<string, string>([[mattermost.mainChannel, mainChannelId]]);
    for (const handle of Object.keys(mattermost.channels)) {
      declaredChannels.set(handle, await this.adminClient.ensureChannel({ handle, teamId }));
    }
    const defaultToolSettings = this.configService.get('agentDefaults.toolSettings');
    for (const agent of agents) {
      const mailSettings = resolveGrantedToolsetSettings(MAIL_TOOLSET, { agent, defaults: defaultToolSettings });
      if (mailSettings) {
        const handle = mailSettings.announcementChannel;
        declaredChannels.set(handle, await this.adminClient.ensureChannel({ handle, teamId }));
      }
    }

    const systemBotId = await this.provisionBot({ teamId, username: mattermost.systemBotUsername });
    // §8.4 — the system bot reconciles the team's slash commands at every boot, which needs the grant
    await this.adminClient.ensureTeamAdmin({ teamId, userId: systemBotId });

    const memberIds = [systemBotId];
    for (const agent of agents) {
      memberIds.push(await this.provisionBot({ teamId, username: agent.username }));
    }

    for (const [handle, channelId] of declaredChannels) {
      for (const userId of memberIds) {
        await this.adminClient.ensureChannelMember({ channelId, userId });
      }
      this.loggingService.log(`provisioning channel "${handle}" with ${memberIds.length} member(s)`);
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
}
