import { Module } from '@nestjs/common';

import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';

import { ResultReader } from './reading/result.reader.ts';
import { RESULT_READER_TOKEN, RESULTS_MOMENT_FORMATTER_TOKEN } from './results.tokens.ts';

@Module({
  exports: [RESULT_READER_TOKEN, RESULTS_MOMENT_FORMATTER_TOKEN],
  providers: [
    ResultReader,
    { provide: RESULT_READER_TOKEN, useExisting: ResultReader },
    { provide: RESULTS_MOMENT_FORMATTER_TOKEN, useExisting: MomentFormatter }
  ]
})
export class ResultsModule {}
