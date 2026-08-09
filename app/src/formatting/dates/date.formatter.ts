import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

/** the locale is fixed because the framework speaks one language (§3.2); only the operator's timezone varies */
@Injectable()
export class DateFormatter extends Intl.DateTimeFormat {
  constructor(configService: ConfigService) {
    super('en-US', {
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      month: 'long',
      second: 'numeric',
      timeZone: configService.get('app.timezone'),
      timeZoneName: 'short',
      year: 'numeric'
    });
  }
}
