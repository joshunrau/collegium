import { createServiceToken } from '@collegium/core/utils';

import type { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';

import type { ResultReader } from './reading/result.reader.ts';

/** the results toolset reaches the turn's stored results through this token, so the declaration stays inert (§2) */
export const RESULT_READER_TOKEN = createServiceToken<ResultReader>('RESULT_READER');

/** the results toolset reaches the shared moment formatter through this token, so the declaration stays inert (§2) */
export const RESULTS_MOMENT_FORMATTER_TOKEN = createServiceToken<MomentFormatter>('RESULTS_MOMENT_FORMATTER');
