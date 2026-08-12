import { Client4, ClientError } from '@mattermost/client';

import {
  $MattermostAccessToken,
  $MattermostBot,
  $MattermostIdentified,
  $MattermostRoles,
  $MattermostUser
} from './mattermost-admin.schemas.ts';

import type { AdminCredentials } from '../provisioning.types.ts';

const NOT_FOUND = 404;

const SYSTEM_ADMIN_ROLE = 'system_admin';

// the wire value for an open channel, and for a team anyone on the server may join. Stated here
// rather than borrowed from the chat adapter: each adapter owns its own mapping onto the vendor.
const OPEN = 'O';

/** what a bot account carries in Mattermost's own listings, so an operator can tell where it came from */
const BOT_DESCRIPTION = 'Provisioned by Collegium';

/**
 * The administrative half of the Mattermost seam, separate from the chat gateway because nothing the
 * running app does needs it: creating accounts, minting their tokens, and creating teams are all
 * system-level, and this client's credentials die with the provisioning process.
 *
 * Every operation is an `ensure`: it states the world the declaration asks for and is safe to repeat,
 * because it runs on every boot against a server that may already hold everything.
 */
export class MattermostAdminClient {
  private readonly sdk: Client4;

  constructor(options: { url: string }) {
    this.sdk = new Client4();
    this.sdk.setUrl(options.url);
  }

  /**
   * Logs the administrator in, creating the account when the server has none. Mattermost exempts the
   * first account of a fresh install from `EnableOpenServer` and grants it system admin, which is the
   * whole of how a bundled server bootstraps itself — so a failure here on a server that already has
   * users means the credentials are wrong, not that provisioning should create anything.
   */
  async authenticate(credentials: AdminCredentials): Promise<void> {
    const loggedIn = await this.sdk
      .login(credentials.username, credentials.password)
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof ClientError && error.status_code === 401) {
          return false;
        }
        throw error;
      });
    if (!loggedIn) {
      await this.sdk
        .createUser(
          {
            email: credentials.email,
            password: credentials.password,
            username: credentials.username
          } as Parameters<Client4['createUser']>[0],
          '',
          ''
        )
        .catch((error: unknown) => {
          throw new Error(
            `could not sign in as "${credentials.username}", and creating the account was refused — a Mattermost that already has users only accepts credentials it already holds`,
            { cause: error }
          );
        });
      await this.sdk.login(credentials.username, credentials.password);
    }
    const { roles } = $MattermostRoles.parse(await this.sdk.getMe());
    if (!roles.includes(SYSTEM_ADMIN_ROLE)) {
      throw new Error(
        `"${credentials.username}" exists but is not a system administrator — creating bots and teams is system-level, so provisioning cannot proceed as this account`
      );
    }
  }

  async ensureBot(params: { teamId: string; username: string }): Promise<string> {
    const existing = await this.findUser(params.username);
    if (existing && !existing.is_bot) {
      throw new Error(
        `a non-bot account already holds "${params.username}" — provisioning refuses to adopt it, because the framework would then post as that user`
      );
    }
    const userId = existing?.id ?? (await this.createBot(params.username));
    // repeat membership blindly: Mattermost answers an already-member add with success
    await this.sdk.addToTeam(params.teamId, userId);
    return userId;
  }

  async ensureChannel(params: { handle: string; teamId: string }): Promise<string> {
    const existing = await this.absentOnNotFound(() => this.sdk.getChannelByName(params.teamId, params.handle));
    if (existing) {
      return $MattermostIdentified.parse(existing).id;
    }
    const created = await this.sdk.createChannel({
      display_name: params.handle,
      name: params.handle,
      team_id: params.teamId,
      type: OPEN
    });
    return $MattermostIdentified.parse(created).id;
  }

  async ensureChannelMember(params: { channelId: string; userId: string }): Promise<void> {
    await this.sdk.addToChannel(params.userId, params.channelId);
  }

  async ensureTeam(handle: string): Promise<string> {
    const existing = await this.absentOnNotFound(() => this.sdk.getTeamByName(handle));
    if (existing) {
      return $MattermostIdentified.parse(existing).id;
    }
    const created = await this.sdk.createTeam({
      display_name: handle,
      name: handle,
      type: OPEN
    } as Parameters<Client4['createTeam']>[0]);
    return $MattermostIdentified.parse(created).id;
  }

  /** §8.4 — the system bot reconciles the team's slash commands, which takes manage_slash_commands */
  async ensureTeamAdmin(params: { teamId: string; userId: string }): Promise<void> {
    await this.sdk.updateTeamMemberSchemeRoles(params.teamId, params.userId, true, true);
  }

  /** Mattermost reveals a token once; the caller is responsible for keeping what this returns */
  async mintAccessToken(userId: string): Promise<string> {
    const minted = await this.sdk.createUserAccessToken(userId, BOT_DESCRIPTION);
    return $MattermostAccessToken.parse(minted).token;
  }

  async waitUntilReachable(params: { attempts: number; intervalMs: number }): Promise<void> {
    for (let attempt = 1; attempt <= params.attempts; attempt++) {
      const reachable = await this.sdk
        .ping(false)
        .then(({ status }) => status === 'OK')
        .catch(() => false);
      if (reachable) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, params.intervalMs));
    }
    throw new Error(`Mattermost did not answer its ping after ${params.attempts} attempts`);
  }

  /** absent is a 404 here and nowhere else: any other refusal is a real failure and must surface */
  private async absentOnNotFound<TValue>(operation: () => Promise<TValue>): Promise<TValue | undefined> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ClientError && error.status_code === NOT_FOUND) {
        return undefined;
      }
      throw error;
    }
  }

  private async createBot(username: string): Promise<string> {
    const created = await this.sdk.createBot({
      description: BOT_DESCRIPTION,
      display_name: username,
      username
    });
    return $MattermostBot.parse(created).user_id;
  }

  private async findUser(username: string): Promise<$MattermostUser | undefined> {
    const existing = await this.absentOnNotFound(() => this.sdk.getUserByUsername(username));
    return existing && $MattermostUser.parse(existing);
  }
}
