import { Global, Module } from '@nestjs/common';

import { DateFormatter } from './dates/date.formatter.ts';
import { TimeOfDayFormatter } from './dates/time-of-day.formatter.ts';
import { TextFormatter } from './text/text.formatter.ts';

@Global()
@Module({
  exports: [DateFormatter, TextFormatter, TimeOfDayFormatter],
  providers: [DateFormatter, TextFormatter, TimeOfDayFormatter]
})
export class FormattingModule {}
