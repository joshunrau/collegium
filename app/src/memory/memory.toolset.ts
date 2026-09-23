import type { ToolResult, ToolTurnScope } from '@collegium/core/tools';
import type { $MemorySettings } from '@collegium/core/toolsets';
import { implementToolset, MEMORY_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import type { ModelRow } from '@/prisma/prisma.types.ts';

import { MEMORY_DATE_FORMATTER_TOKEN, MEMORY_SERVICE_TOKEN, MEMORY_SIGHTINGS_TOKEN } from './memory.tokens.ts';
import {
  appendToBody,
  renderMemoryBody,
  renderMemoryFailure,
  renderRevisionResult,
  renderUnresolvedReference,
  renderWriteResult,
  replacePassages
} from './memory.utils.ts';

import type { MemoryEdit, MemoryFailure, MemoryRevision, MemoryRevisionReceipt } from './memory.types.ts';

const $Reference = z.string().min(1).describe('The reference of the memory entry, as listed beside its description');

const $NewDescription = z
  .string()
  .min(1)
  .optional()
  .describe('A new one-line description stating when this memory matters; omit it to keep the current one');

const $Edit = z.object({
  passage: z.string().min(1).describe('The exact text to replace, as it appears in the memory'),
  replacement: z.string().describe('The text to put in its place; empty removes the passage')
});

const $ReplaceArgs = z.object({
  description: $NewDescription,
  edits: z
    .array($Edit)
    .min(1)
    .optional()
    .describe(
      'Several passages to replace in one step, instead of passage and replacement. They apply in order, each to the text the one before it left; if any passage does not occur exactly once, none is applied'
    ),
  passage: $Edit.shape.passage.optional(),
  reference: $Reference,
  replacement: $Edit.shape.replacement.optional()
});

/** what one replace substitutes: one passage, or several edits — never both, never neither */
type ReplaceTarget =
  | (z.infer<typeof $ReplaceArgs> & {
      readonly edits: readonly MemoryEdit[];
      readonly passage?: undefined;
      readonly replacement?: undefined;
    })
  | (z.infer<typeof $ReplaceArgs> & {
      readonly edits?: undefined;
      readonly passage: string;
      readonly replacement: string;
    });

const $Replace = $ReplaceArgs.refine((args): args is ReplaceTarget => {
  const single = args.passage !== undefined && args.replacement !== undefined;
  return args.edits === undefined ? single : args.passage === undefined && args.replacement === undefined;
}, 'give passage and replacement, or edits, never both');

/** §3.6 — the entry a revision names, with the revising turn's provenance and the description it names, if any */
function toRevision(
  args: { readonly description?: string; readonly reference: string },
  turn: ToolTurnScope
): MemoryRevision {
  return {
    agentUsername: turn.agentUsername,
    description: args.description,
    originPostId: turn.triggeringPostId,
    reference: args.reference
  };
}

/** §3.6 — the trace records the revision with its count and whatever it replaced; the model reads the size it left */
function toRevisionResult(
  revised: Result<MemoryRevisionReceipt<ModelRow<'Memory'>>, MemoryFailure>,
  caps: $MemorySettings,
  replacedPassagesOf: (previous: ModelRow<'Memory'>) => readonly string[] | undefined = () => undefined
): ToolResult {
  if (!revised.success) {
    return Result.err({ kind: 'invalid-arguments', message: renderMemoryFailure(revised.error) });
  }
  const { entry, previous, reference } = revised.value;
  const replacedPassages = replacedPassagesOf(previous);
  return Result.ok({
    disclosure: {
      body: entry.body,
      description: entry.description,
      reference,
      revision: {
        count: entry.revision,
        ...(entry.description !== previous.description && { replacedDescription: previous.description }),
        ...(replacedPassages !== undefined && { replacedPassages })
      }
    },
    text: renderRevisionResult({ bodyLength: entry.body.length, reference }, caps)
  });
}

export const MEMORY_TOOLSET = implementToolset(MEMORY_TOOLSET_DEF, {
  services: {
    dateFormatter: MEMORY_DATE_FORMATTER_TOKEN,
    memory: MEMORY_SERVICE_TOKEN,
    sightings: MEMORY_SIGHTINGS_TOKEN
  },
  tools: {
    // §3.6 — ungated like a write, and one step rather than a delete and a write
    append: {
      description:
        'Add text to the end of one of your memories, on a new line. It is applied to the memory as stored, in one step. The memory keeps its reference, and its description unless you give a new one.',
      execute: async (args, context) => {
        const revised = await context.memory.revise(
          toRevision(args, context.turn),
          (stored) => Result.ok(appendToBody(stored.body, args.text)),
          context.settings
        );
        if (revised.success) {
          context.sightings.recordRevised(context.turn.turnId, revised.value.entry);
        }
        return toRevisionResult(revised, context.settings);
      },
      parameters: z.object({
        description: $NewDescription,
        reference: $Reference,
        text: z.string().min(1).describe('The text to add after the current body')
      }),
      traceDetail: (args) => args.reference
    },
    // §3.6 — ungated for the same reason a write is, and only of the revision this turn has seen
    delete: {
      description:
        'Delete one of your memories. Only a memory you read or wrote in this turn can be deleted, and only while no other turn has revised it since. To change a memory, its description included, revise it with memory__append, memory__replace or memory__rewrite rather than writing a new one and deleting the old.',
      execute: async (args, context) => {
        const deleted = await context.memory.deleteAdmitted(context.turn.agentUsername, args.reference, (entry) => {
          return context.sightings.confirmSeen(context.turn.turnId, entry);
        });
        if (!deleted.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderMemoryFailure(deleted.error) });
        }
        return Result.ok({ text: `memory ${args.reference} deleted: ${deleted.value.description}` });
      },
      parameters: z.object({ reference: $Reference }),
      /** a repeat resolves to deleted-or-not-found, and both end states are the entry being absent */
      retryable: true,
      traceDetail: (args) => args.reference
    },
    read: {
      budgetExempt: true,
      concurrent: true,
      description: 'Read the full body of one of your memories.',
      execute: async (args, context) => {
        const memory = await context.memory.read(context.turn.agentUsername, args.reference);
        if (!memory.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderUnresolvedReference(memory.error) });
        }
        await context.memory.markUsed(memory.value.id);
        context.sightings.recordSeen(context.turn.turnId, memory.value);
        return Result.ok({
          text: renderMemoryBody(memory.value, new Date(), (date) => context.dateFormatter.format(date))
        });
      },
      parameters: z.object({ reference: $Reference }),
      retryable: true,
      traceDetail: (args) => args.reference
    },
    // §3.6 — ungated like a write, and one step rather than a delete and a write
    replace: {
      description:
        'Replace one passage of one of your memories with new text, or several passages at once with edits. Each passage must occur exactly once in the memory. It is applied to the memory as stored, in one step. The memory keeps its reference, and its description unless you give a new one.',
      execute: async (args, context) => {
        const edits = args.edits ?? [{ passage: args.passage, replacement: args.replacement }];
        const revised = await context.memory.revise(
          toRevision(args, context.turn),
          (stored) => replacePassages(stored.body, edits),
          context.settings
        );
        if (revised.success) {
          context.sightings.recordRevised(context.turn.turnId, revised.value.entry);
        }
        return toRevisionResult(revised, context.settings, () => edits.map(({ passage }) => passage));
      },
      parameters: $Replace,
      traceDetail: (args) => args.reference
    },
    // §3.6 — a whole body, so it is guarded as a delete is: only of the revision this turn has seen
    rewrite: {
      description:
        'Replace the whole body of one of your memories in one step, and its description if you give a new one. Use it to restructure or shorten a memory; to change a passage, use memory__replace. Only a memory you read or wrote in this turn can be rewritten, and only while no other turn has revised it since, so nothing added after you read it is lost. The memory keeps its reference.',
      execute: async (args, context) => {
        const revised = await context.memory.revise(
          toRevision(args, context.turn),
          (stored) => context.sightings.confirmSeen(context.turn.turnId, stored).pipe(() => args.body),
          context.settings
        );
        if (revised.success) {
          context.sightings.recordSeen(context.turn.turnId, revised.value.entry);
        }
        return toRevisionResult(revised, context.settings, (previous) => [previous.body]);
      },
      parameters: z.object({
        body: z.string().min(1).describe('The whole new body, which replaces the current one'),
        description: $NewDescription,
        reference: $Reference
      }),
      traceDetail: (args) => args.reference
    },
    // §3.6 — the single ungated write: gating memory formation would park a turn on a triviality
    write: {
      description:
        'Save a memory: a one-line description shown to you on every turn, and a body you can read back on demand. Keep the description to one short line; a long one is refused, and so is a body over its cap.',
      execute: async (args, context) => {
        const written = await context.memory.write(
          {
            agentUsername: context.turn.agentUsername,
            body: args.body,
            description: args.description,
            originPostId: context.turn.triggeringPostId
          },
          context.settings
        );
        if (!written.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderMemoryFailure(written.error) });
        }
        context.sightings.recordSeen(context.turn.turnId, written.value.entry);
        const { evictedDescriptions, reference } = written.value;
        return Result.ok({
          disclosure: {
            body: args.body,
            description: args.description,
            reference,
            supersededDescriptions: evictedDescriptions
          },
          text: renderWriteResult({ bodyLength: args.body.length, evictedDescriptions, reference }, context.settings)
        });
      },
      parameters: z.object({
        body: z.string().min(1).describe('The content to remember'),
        description: z.string().min(1).describe('One line stating when this memory matters')
      })
    }
  }
});
