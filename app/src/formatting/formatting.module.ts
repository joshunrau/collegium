import { Global, Module } from '@nestjs/common';

import { DateFormatter } from './dates/date.formatter.ts';
import { DayFormatter } from './dates/day.formatter.ts';
import { TimeOfDayFormatter } from './dates/time-of-day.formatter.ts';
import { TextFormatter } from './text/text.formatter.ts';

@Global()
@Module({
  exports: [DateFormatter, DayFormatter, TextFormatter, TimeOfDayFormatter],
  providers: [DateFormatter, DayFormatter, TextFormatter, TimeOfDayFormatter]
})
export class FormattingModule {}
