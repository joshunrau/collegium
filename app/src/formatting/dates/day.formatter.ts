import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

/** the calendar day an instant falls on in the operator's timezone, weekday first, with no time of day (§3.8) */
@Injectable()
export class DayFormatter extends Intl.DateTimeFormat {
  constructor(configService: ConfigService) {
    super('en-US', { dateStyle: 'full', timeZone: configService.get('display.timezone') });
  }
}
