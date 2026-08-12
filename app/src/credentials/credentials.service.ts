import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

/**
 * The tokens provisioning minted, which are the only copies that will ever exist: Mattermost reveals
 * an access token once and never again. Losing the store means minting replacements and orphaning
 * what it held, so nothing here deletes.
 */
@Injectable()
export class CredentialsService {
  constructor(@InjectModel('MattermostCredential') private readonly credentials: Model<'MattermostCredential'>) {}

  /**
   * The token an account already has, or one minted now and kept. A held token is re-minted only
   * when its userId no longer matches the account provisioning just ensured — a rebuilt Mattermost
   * recreates the bots under new ids, and the old token authenticates nothing.
   */
  async ensure(params: { mint: () => Promise<string>; userId: string; username: string }): Promise<string> {
    const held = await this.credentials.findUnique({
      select: { token: true, userId: true },
      where: { username: params.username }
    });
    if (held?.userId === params.userId) {
      return held.token;
    }
    const token = await params.mint();
    await this.credentials.upsert({
      create: { token, userId: params.userId, username: params.username },
      update: { token, userId: params.userId },
      where: { username: params.username }
    });
    return token;
  }

  /** the token for an account, or undefined where provisioning has not reached it yet */
  async find(username: string): Promise<string | undefined> {
    const row = await this.credentials.findUnique({ select: { token: true }, where: { username } });
    return row?.token;
  }

  /**
   * The token for an account the app cannot run without. Absent means provisioning has not reached
   * this account — a newly declared agent whose start was never provisioned — which boot refuses
   * rather than starting an agent that cannot speak.
   */
  async require(username: string): Promise<string> {
    const token = await this.find(username);
    if (token === undefined) {
      throw new Error(`"${username}" has no provisioned Mattermost token; provisioning must run before the app`);
    }
    return token;
  }
}
