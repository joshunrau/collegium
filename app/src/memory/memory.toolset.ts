import type { ToolResult } from '@collegium/core/tools';
import { implementToolset, MEMORY_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import type { ModelRow } from '@/prisma/prisma.types.ts';

import { MEMORY_SERVICE_TOKEN } from './memory.tokens.ts';
import {
  appendToBody,
  renderMemoryBody,
  renderMemoryFailure,
  renderUnresolvedReference,
  replaceSinglePassage
} from './memory.utils.ts';

import type { MemoryFailure, MemoryRevisionReceipt } from './memory.types.ts';

const $Reference = z.string().min(1).describe('The reference of the memory entry, as listed beside its description');

/** §3.6 — the trace records the revision beside the reference it replaced, and the model reads both */
function toRevisionResult(revised: Result<MemoryRevisionReceipt<ModelRow<'Memory'>>, MemoryFailure>): ToolResult {
  if (!revised.success) {
    return Result.err({ kind: 'invalid-arguments', message: renderMemoryFailure(revised.error) });
  }
  const { entry, reference, revisionOf } = revised.value;
  return Result.ok({
    disclosure: { body: entry.body, description: entry.description, reference, revisionOf },
    text: `memory ${revisionOf} revised as ${reference}`
  });
}

export const MEMORY_TOOLSET = implementToolset(MEMORY_TOOLSET_DEF, {
  services: { memory: MEMORY_SERVICE_TOKEN },
  tools: {
    // §3.6 — ungated like a write, and one step rather than a delete and a write
    append: {
      description:
        'Add text to the end of one of your memories, on a new line. The memory keeps its description and gets a new reference.',
      execute: async (args, context) => {
        const revised = await context.memory.revise(
          {
            agentUsername: context.turn.agentUsername,
            originPostId: context.turn.triggeringPostId,
            reference: args.reference
          },
          (body) => Result.ok(appendToBody(body, args.text)),
          context.settings
        );
        return toRevisionResult(revised);
      },
      parameters: z.object({
        reference: $Reference,
        text: z.string().min(1).describe('The text to add after the current body')
      }),
      traceDetail: (args) => args.reference
    },
    // §3.6 — ungated for the same reason a write is
    delete: {
      description:
        'Delete one of your memories. To correct or extend a memory instead, use memory__append or memory__replace.',
      execute: async (args, context) => {
        const deleted = await context.memory.delete(context.turn.agentUsername, args.reference);
        if (!deleted.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderUnresolvedReference(deleted.error) });
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
        return Result.ok({ text: renderMemoryBody(memory.value, new Date()) });
      },
      parameters: z.object({ reference: $Reference }),
      retryable: true,
      traceDetail: (args) => args.reference
    },
    // §3.6 — ungated like a write, and one step rather than a delete and a write
    replace: {
      description:
        'Replace one passage of one of your memories with new text. The passage must occur exactly once in the memory. The memory keeps its description and gets a new reference.',
      execute: async (args, context) => {
        const revised = await context.memory.revise(
          {
            agentUsername: context.turn.agentUsername,
            originPostId: context.turn.triggeringPostId,
            reference: args.reference
          },
          (body) => replaceSinglePassage(body, args.passage, args.replacement),
          context.settings
        );
        return toRevisionResult(revised);
      },
      parameters: z.object({
        passage: z.string().min(1).describe('The exact text to replace, as it appears in the memory'),
        reference: $Reference,
        replacement: z.string().describe('The text to put in its place; empty removes the passage')
      }),
      traceDetail: (args) => args.reference
    },
    // §3.6 — the single ungated write: gating memory formation would park a turn on a triviality
    write: {
      description:
        'Save a memory: a one-line description shown to you on every turn, and a body you can read back on demand.',
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
        return Result.ok({
          disclosure: {
            body: args.body,
            description: args.description,
            reference: written.value.reference,
            supersededDescriptions: written.value.evictedDescriptions
          },
          text: `memory ${written.value.reference} saved`
        });
      },
      parameters: z.object({
        body: z.string().min(1).describe('The content to remember'),
        description: z.string().min(1).describe('One line stating when this memory matters')
      })
    }
  }
});
