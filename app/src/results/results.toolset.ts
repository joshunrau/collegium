import { implementToolset, RESULTS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import {
  LISTED_REFERENCES,
  READ_REPLAY_LINE,
  renderOffsetPastEnd,
  renderOffsetRead,
  renderRecordFind,
  renderUnknownReference
} from './reading/record-read.utils.ts';
import { RESULT_READER_TOKEN, RESULTS_MOMENT_FORMATTER_TOKEN } from './results.tokens.ts';

/** core (§8): every result of a turn is a record, and this reads on in one the turn was shown in part or as its line (§3.8) */
export const RESULTS_TOOLSET = implementToolset(RESULTS_TOOLSET_DEF, {
  services: { moments: RESULTS_MOMENT_FORMATTER_TOKEN, results: RESULT_READER_TOKEN },
  tools: {
    read: {
      concurrent: true,
      description:
        'Read a result of this turn that is shown only in part, or only as its line: from an offset, or by finding up to five phrases in it. A result’s reference (r7, r12, …) is named where it is shown in part or replaced. References last until this turn ends, and each read counts against your action budget.',
      execute: async (args, context) => {
        const ref = `r${args.ref.replace(/^r/u, '')}`;
        const record = await context.results.read(context.turn.turnId, Number(ref.slice(1)));
        if (record === undefined) {
          const refs = await context.results.listRefs(context.turn.turnId, LISTED_REFERENCES);
          return Result.err({ kind: 'invalid-arguments', message: renderUnknownReference(ref, refs) });
        }
        const recordedAt = context.moments.format(record.recordedAt, new Date());
        if (args.find !== undefined) {
          const text = renderRecordFind({
            offsetIgnored: args.offset !== undefined,
            output: record.output,
            phrases: args.find,
            recordedAt,
            ref
          });
          return Result.ok({ replay: READ_REPLAY_LINE, text });
        }
        const offset = args.offset ?? 0;
        if (offset > 0 && offset >= record.output.length) {
          return Result.err({
            kind: 'invalid-arguments',
            message: renderOffsetPastEnd(ref, offset, record.output.length)
          });
        }
        const read = renderOffsetRead({
          offset,
          output: record.output,
          recordedAt,
          ref,
          widthChars: record.viewChars ?? record.output.length
        });
        return Result.ok({
          readOn: { offset, ref, textIndex: read.textIndex },
          replay: READ_REPLAY_LINE,
          text: read.text
        });
      },
      parameters: z.object({
        find: z
          .array(z.string().trim().min(1))
          .min(1)
          .max(5)
          .optional()
          .describe(
            'Up to five phrases to find anywhere in the result, each matched without regard to case or line breaks; with it, offset is ignored'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Where in the result to read from, in characters; omit it to read from the start'),
        ref: z
          .string()
          .regex(/^r?\d+$/u)
          .describe('The result’s reference, as its view line or its line names it: r7')
      }),
      retryable: true,
      traceDetail: (args) => {
        if (args.find !== undefined) {
          return `${args.ref} find ${args.find.join(' · ')}`;
        }
        return args.offset === undefined ? args.ref : `${args.ref} from ${args.offset}`;
      }
    }
  }
});
