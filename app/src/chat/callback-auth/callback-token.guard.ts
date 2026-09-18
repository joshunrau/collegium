import { Injectable } from '@nestjs/common';

import { EnvService } from '@/config/env/env.service.ts';

import { BearerTokenGuard } from './bearer-token.guard.ts';

/** §6.4 — what the Mattermost plugin presents on the command route: the credential that can stop a turn */
@Injectable()
export class CallbackTokenGuard extends BearerTokenGuard {
  protected readonly secret: string;

  constructor(envService: EnvService) {
    super();
    this.secret = envService.get('CALLBACK_TOKEN');
  }
}
