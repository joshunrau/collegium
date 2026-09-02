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

    // The system bot is the only account placed in every declared channel, because it posts the
    // deterministic notices (§3.2) into all of them. Every agent joins the main channel and nothing
    // else: who belongs in the rest is the operator's to say in Mattermost, and the §3.10 one-agent
    // rule is then checked against the membership they set rather than against a second declaration
    // that would have to agree with it. A declared channel is still created, because boot resolves
    // every declared handle to an id and one that names nothing would refuse to start.
    await this.provisionChannel({
      handle: mattermost.mainChannel,
      memberIds: [systemBotId, ...provisioned.map(({ userId }) => userId)],
      teamId
    });
    for (const handle of Object.keys(mattermost.channels)) {
      await this.provisionChannel({ handle, memberIds: [systemBotId], teamId });
    }
    const defaultToolSettings = this.configService.get('agentDefaults.toolSettings');
    for (const { agent, userId } of provisioned) {
      const mailSettings = resolveGrantedToolsetSettings(MAIL_TOOLSET, { agent, defaults: defaultToolSettings });
      if (mailSettings) {
        // the one membership the operator does not own: boot refuses a mailbox whose agent cannot
        // post where its arrivals are announced, and the pairing is already stated in config.json
        await this.provisionChannel({
          handle: mailSettings.announcementChannel,
          memberIds: [systemBotId, userId],
          teamId
        });
      }
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
