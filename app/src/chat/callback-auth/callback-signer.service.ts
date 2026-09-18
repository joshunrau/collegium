import { Injectable } from '@nestjs/common';

import { EnvService } from '@/config/env/env.service.ts';

import { signCallback, verifyCallback } from './callback-auth.utils.ts';

/**
 * §6.4 — the one holder of `CALLBACK_TOKEN` on the decision routes. Mattermost assembles those
 * requests from a button's context and a dialog's state, which it stores and, for the dialog,
 * hands to the deciding user's client, so the secret itself is never written into either: each
 * carries a signature over its one approval instead, minted here and verified here.
 */
@Injectable()
export class CallbackSigner {
  private readonly secret: string;

  constructor(envService: EnvService) {
    this.secret = envService.get('CALLBACK_TOKEN');
  }

  sign(parts: readonly string[]): string {
    return signCallback(this.secret, parts);
  }

  verify(parts: readonly string[], signature: string): boolean {
    return verifyCallback(this.secret, parts, signature);
  }
}
