import { Injectable } from '@nestjs/common';

import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';

/** §3.8 — the day alone; a time of day stated as the turn starts is stale within minutes, so the time is builtins::now's */
@Injectable()
export class DateLineSection {
  constructor(
    private readonly dayFormatter: DayFormatter,
    private readonly textFormatter: TextFormatter
  ) {}

  render(): string {
    return this.textFormatter.formatParagraphs(
      ['## Date', "Today is {day}, in the operator's timezone ({timezone})."],
      {
        day: this.dayFormatter.format(new Date()),
        timezone: this.dayFormatter.resolvedOptions().timeZone
      }
    );
  }
}
