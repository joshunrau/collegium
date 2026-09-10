import { Global, Module } from '@nestjs/common';

import { DateFormatter } from './dates/date.formatter.ts';
import { TextFormatter } from './text/text.formatter.ts';

@Global()
@Module({
  exports: [DateFormatter, TextFormatter],
  providers: [DateFormatter, TextFormatter]
})
export class FormattingModule {}
