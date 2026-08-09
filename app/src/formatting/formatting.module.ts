import { Global, Module } from '@nestjs/common';

import { DateFormatter } from './dates/date.formatter.ts';

@Global()
@Module({
  exports: [DateFormatter],
  providers: [DateFormatter]
})
export class FormattingModule {}
