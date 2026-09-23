import { Global, Module } from '@nestjs/common';

import { DateFormatter } from './dates/date.formatter.ts';
import { DayFormatter } from './dates/day.formatter.ts';
import { MomentFormatter } from './dates/moment.formatter.ts';
import { TimeOfDayFormatter } from './dates/time-of-day.formatter.ts';
import { TextFormatter } from './text/text.formatter.ts';

@Global()
@Module({
  exports: [DateFormatter, DayFormatter, MomentFormatter, TextFormatter, TimeOfDayFormatter],
  providers: [DateFormatter, DayFormatter, MomentFormatter, TextFormatter, TimeOfDayFormatter]
})
export class FormattingModule {}
