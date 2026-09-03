import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { renderIsoWithOffset } from './clock.utils.ts';

/** the current instant as the model reads it: spoken form with the weekday, then ISO 8601 with its offset, both in the operator's timezone */
@Injectable()
export class ClockService {
  private readonly partsFormat: Intl.DateTimeFormat;
  private readonly spokenFormat: Intl.DateTimeFormat;

  constructor(configService: ConfigService) {
    const timeZone = configService.get('display.timezone');
    this.spokenFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone });
    this.partsFormat = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric'
    });
  }

  now(): string {
    return this.render(new Date());
  }

  render(instant: Date): string {
    return `${this.spokenFormat.format(instant)} (${renderIsoWithOffset(this.partsFormat.formatToParts(instant))})`;
  }
}
