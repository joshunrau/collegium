import { Injectable } from '@nestjs/common';

import { BearerTokenGuard } from '@/chat/callback-auth/bearer-token.guard.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

/**
 * §6.4 — what a trigger sender presents, and the only thing it holds: a credential that can announce
 * work and cannot run a command or answer an approval. Optional, and its absence closes the route.
 */
@Injectable()
export class TriggerTokenGuard extends BearerTokenGuard {
  protected readonly secret: string | undefined;

  constructor(envService: EnvService, loggingService: LoggingService) {
    super();
    this.secret = envService.get('TRIGGER_TOKEN');
    if (this.secret === undefined) {
      loggingService.warn('HTTP trigger intake is disabled: TRIGGER_TOKEN is not set');
    }
  }
}
