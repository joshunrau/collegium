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

  /** the token an account already has, or one minted now and kept — minting is never repeated */
  async ensure(params: { mint: () => Promise<{ token: string; userId: string }>; username: string }): Promise<string> {
    const held = await this.find(params.username);
    if (held !== undefined) {
      return held;
    }
    const minted = await params.mint();
    await this.credentials.create({
      data: { token: minted.token, userId: minted.userId, username: params.username }
    });
    return minted.token;
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
