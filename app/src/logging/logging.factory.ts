import { Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { JSONLogger } from './adapters/json.logger.ts';

/**
 * Hands out context-labelled loggers to code that constructs its collaborators by hand, so call
 * sites do not re-read the configured level.
 */
@Injectable()
export class LoggerFactory {
  constructor(private readonly configService: ConfigService) {}

  createLogger(context: string): LoggerService {
    return new JSONLogger(context, this.configService.get('logging.level'));
  }
}
