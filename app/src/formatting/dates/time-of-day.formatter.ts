import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

/** a time of day on a post that already carries its date, in the operator's timezone and naming it (§3.2) */
@Injectable()
export class TimeOfDayFormatter extends Intl.DateTimeFormat {
  constructor(configService: ConfigService) {
    super('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: configService.get('display.timezone'),
      timeZoneName: 'short'
    });
  }
}
