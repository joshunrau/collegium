import { Injectable } from '@nestjs/common';

import { DayFormatter } from './day.formatter.ts';
import { TimeOfDayFormatter } from './time-of-day.formatter.ts';

/** when something happened, in the operator's timezone: the time of day on the day it is now there, and the day too before it */
@Injectable()
export class MomentFormatter {
  constructor(
    private readonly dayFormatter: DayFormatter,
    private readonly timeOfDayFormatter: TimeOfDayFormatter
  ) {}

  format(moment: Date, now: Date): string {
    const time = this.timeOfDayFormatter.format(moment);
    const day = this.dayFormatter.format(moment);
    return day === this.dayFormatter.format(now) ? time : `${time} on ${day}`;
  }
}
