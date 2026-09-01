import type { AdminCredentials } from '@collegium/config';
import { Client4, ClientError } from '@mattermost/client';

import {
  $MattermostAccessToken,
  $MattermostBot,
  $MattermostIdentified,
  $MattermostRoles,
  $MattermostServerSettings,
  $MattermostUser
} from './mattermost-admin.schemas.ts';
import { refusesCallbacks } from './mattermost-admin.utils.ts';

const NOT_FOUND = 404;

const SYSTEM_ADMIN_ROLE = 'system_admin';

type HydratedTeam = Parameters<Client4['createTeam']>[0];
type HydratedUser = Parameters<Client4['createUser']>[0];

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
   * Client4 types each create call over the fully hydrated resource, though the wire accepts just
   * the fields a creation states. The one widening the vendor forces lives here, so no call site casts.
   */
  private static asHydrated<TResource>(creationFields: Partial<TResource>): TResource {
    return creationFields as TResource;
  }

  /**
   * Refuses a server whose settings cannot carry this deployment, naming each one, before anything
   * is created. Two of them stop provisioning at its first write; the third stops nothing at all —
   * an unreachable app is a Mattermost that accepts every approval click and delivers none.
   */
  async assertServerSupportsDeployment(params: { publicUrl: string }): Promise<void> {
    const { ServiceSettings } = $MattermostServerSettings.parse(await this.sdk.getConfig());
    const refusals: string[] = [];
    if (!ServiceSettings.EnableBotAccountCreation) {
      refusals.push('ServiceSettings.EnableBotAccountCreation, without which no agent account can exist');
    }
    if (!ServiceSettings.EnableUserAccessTokens) {
      refusals.push(
        'ServiceSettings.EnableUserAccessTokens, without which no account can hold the token it posts with'
      );
    }
    const allowed = ServiceSettings.AllowedUntrustedInternalConnections;
    if (await refusesCallbacks({ allowed, publicUrl: params.publicUrl })) {
      refusals.push(
        `ServiceSettings.AllowedUntrustedInternalConnections, which must list ${new URL(params.publicUrl).hostname} for approval decisions, slash commands, and triggers to reach the app`
      );
    }
    if (refusals.length > 0) {
      throw new Error(`Mattermost is missing settings this deployment needs: ${refusals.join('; ')}`);
    }
  }

  /**
   * Establishes the administrator provisioning acts as, and refuses one that is not a system
   * administrator — creating bots and teams is system-level, so nothing narrower can proceed.
   */
  async authenticate(credentials: AdminCredentials): Promise<void> {
    if (credentials.kind === 'token') {
      this.sdk.setToken(credentials.token);
    } else {
      await this.signIn(credentials);
    }
    const identity = await this.sdk.getMe().catch((error: unknown) => {
      throw new Error('Mattermost refused the administrator credentials provisioning was given', { cause: error });
    });
    const { roles } = $MattermostRoles.parse(identity);
    if (!roles.includes(SYSTEM_ADMIN_ROLE)) {
      throw new Error(
        'the administrator provisioning authenticated as is not a system administrator — creating bots and teams is system-level, so provisioning cannot proceed as this account'
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
    return this.ensureIdentified({
      create: () =>
        this.sdk
          .createChannel({ display_name: params.handle, name: params.handle, team_id: params.teamId, type: OPEN })
          .catch((error: unknown) => {
            throw new Error(
              `could not create channel "${params.handle}" — an archived channel may already hold the name, which the lookup does not see`,
              { cause: error }
            );
          }),
      lookup: () => this.sdk.getChannelByName(params.teamId, params.handle)
    });
  }

  async ensureChannelMember(params: { channelId: string; userId: string }): Promise<void> {
    await this.sdk.addToChannel(params.userId, params.channelId);
  }

  async ensureTeam(handle: string): Promise<string> {
    return this.ensureIdentified({
      create: () =>
        this.sdk.createTeam(
          MattermostAdminClient.asHydrated<HydratedTeam>({ display_name: handle, name: handle, type: OPEN })
        ),
      lookup: () => this.sdk.getTeamByName(handle)
    });
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

  private async ensureIdentified(operations: {
    create: () => Promise<unknown>;
    lookup: () => Promise<unknown>;
  }): Promise<string> {
    const existing = await this.absentOnNotFound(operations.lookup);
    return $MattermostIdentified.parse(existing ?? (await operations.create())).id;
  }

  private async findUser(username: string): Promise<$MattermostUser | undefined> {
    const existing = await this.absentOnNotFound(() => this.sdk.getUserByUsername(username));
    return existing && $MattermostUser.parse(existing);
  }

  /**
   * Signs the administrator in, creating the account when the server has none. Mattermost exempts
   * the first account of a fresh install from `EnableOpenServer` and grants it system admin, which
   * is the whole of how a bundled server bootstraps itself. A server someone else already runs is
   * provisioned with a token instead, which reaches none of this.
   */
  private async signIn(credentials: { email: string; password: string; username: string }): Promise<void> {
    const loggedIn = await this.sdk
      .login(credentials.username, credentials.password)
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof ClientError && error.status_code === 401) {
          return false;
        }
        throw error;
      });
    if (loggedIn) {
      return;
    }
    await this.sdk
      .createUser(
        MattermostAdminClient.asHydrated<HydratedUser>({
          email: credentials.email,
          password: credentials.password,
          username: credentials.username
        }),
        '',
        ''
      )
      .catch((error: unknown) => {
        throw new Error(
          `could not sign in as "${credentials.username}", and creating the account was refused — a Mattermost that already has users only accepts credentials it already holds, and takes MATTERMOST_ADMIN_TOKEN rather than a password`,
          { cause: error }
        );
      });
    await this.sdk.login(credentials.username, credentials.password);
  }
}
