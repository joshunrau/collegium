import { Inject, Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';

import { ConfigService } from '@/config/config.service.ts';

import { JSONLogger } from './adapters/json.logger.ts';

@Injectable({ scope: Scope.TRANSIENT })
export class LoggingService extends JSONLogger {
  constructor(@Inject(INQUIRER) parentClass: object | undefined, configService: ConfigService) {
    super(parentClass?.constructor.name, configService.get('app.logLevel'));
  }
}
