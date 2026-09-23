import { implementToolset, TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { TASKS_SERVICE_TOKEN } from './tasks.tokens.ts';
import { ASSIGNEE_TARGETS, CREATOR_TARGETS, renderTaskRefusal, renderUnitRecord } from './tasks.utils.ts';

import type { TaskFailure } from './tasks.types.ts';

/** the two write verbs act on open units, which the prompt lists; a read reaches a closed one too (§3.15) */
const $OpenReference = z
  .string()
  .min(1)
  .describe('The reference of the work unit, as listed under Open work in your system prompt');

const $AnyReference = z
  .string()
  .min(1)
  .describe(
    'The reference of the work unit: from the Open work section of your system prompt, or from the post in this channel that assigned, reported or closed it'
  );

const refused = (failure: TaskFailure) => {
  return Result.err({ kind: 'invalid-arguments' as const, message: renderTaskRefusal(failure) });
};

/** §3.15 — every verb renders a post the framework publishes first, and writes only once told the post has landed */
export const TASKS_TOOLSET = implementToolset(TASKS_TOOLSET_DEF, {
  services: { tasks: TASKS_SERVICE_TOKEN },
  tools: {
    assign: {
      description:
        'Hand one unit of work to a colleague in this channel: the result you need, how you will judge it, and what they need to know. The framework posts it mentioning them, which starts their turn once yours ends, and records the unit. Their report is posted mentioning you and starts your turn once theirs ends, so a work order needs no instruction to mention you. Only you can close the unit. A question to a colleague is a post, not a unit.',
      execute: async (args, context) => {
        const prepared = await context.tasks.prepareAssign({
          actingAgentUsername: context.turn.agentUsername,
          assigneeUsername: args.assignee,
          channelId: context.turn.channelId,
          context: args.context,
          criteria: args.criteria,
          openUnitCap: context.settings.openUnitCap,
          outcome: args.outcome,
          turnId: context.turn.turnId
        });
        if (!prepared.success) {
          return refused(prepared.error);
        }
        const { addressee, prepared: unit, text } = prepared.value;
        return Result.ok({
          post: { addressee, onPublished: (postId) => context.tasks.commitAssign(unit, postId), text },
          text: `unit ${unit.id.slice(0, 8)} assigned to @${unit.assigneeUsername}, whose turn starts when this turn ends`
        });
      },
      parameters: z.object({
        assignee: z
          .string()
          .min(1)
          .describe('The username of the peer taking this on, as listed under Peers in your system prompt'),
        context: z
          .string()
          .min(1)
          .describe(
            'What is already established: what was tried, what it produced, what has been ruled out, and anything you learned outside this channel. The assignee reads the recent history of this channel and nothing else.'
          ),
        criteria: z
          .string()
          .min(1)
          .describe(
            'How you will judge the result when it comes back. State it as a checkable condition, not as a step, and one the context you are supplying can meet.'
          ),
        outcome: z.string().min(1).describe('The result you need, stated as a result rather than as a step')
      }),
      traceDetail: (args) => `@${args.assignee}: ${args.outcome}`
    },
    close: {
      description:
        'Close a unit you handed over, after reading the result: done when it meets your criteria, or when the report shows a criterion of yours could not be met from what you supplied, with that verdict; cancelled with the reason when the work will never be right. Only the creator closes a unit; to try again, hand over a fresh unit with corrected criteria.',
      execute: async (args, context) => {
        const prepared = await context.tasks.prepareClose({
          actingAgentUsername: context.turn.agentUsername,
          channelId: context.turn.channelId,
          reference: args.reference,
          to: args.state,
          verdict: args.verdict
        });
        if (!prepared.success) {
          return refused(prepared.error);
        }
        const { prepared: transition, text } = prepared.value;
        return Result.ok({
          post: { onPublished: (postId) => context.tasks.commitTransition(transition, postId), text },
          text: `unit ${args.reference} closed as ${args.state}`
        });
      },
      parameters: z.object({
        reference: $OpenReference,
        state: z
          .enum(CREATOR_TARGETS)
          .describe(
            'done when the result meets your criteria or your criterion was the defect; cancelled when the work never will'
          ),
        verdict: z
          .string()
          .min(1)
          .describe('Your judgement of the result and what you checked to reach it, in one or two sentences')
      }),
      traceDetail: (args) => `${args.reference} → ${args.state}`
    },
    read: {
      budgetExempt: true,
      concurrent: true,
      description:
        'Read one work unit in full: its outcome, criteria, context, parties and state. A unit you created or were assigned in this channel reads whether it is open or closed.',
      execute: async (args, context) => {
        const unit = await context.tasks.read(context.turn.agentUsername, context.turn.channelId, args.reference);
        if (!unit.success) {
          return refused(unit.error);
        }
        return Result.ok({ text: renderUnitRecord(unit.value) });
      },
      parameters: z.object({ reference: $AnyReference }),
      retryable: true,
      traceDetail: (args) => args.reference
    },
    report: {
      description:
        'Report on a unit handed to you: review when the result is ready for its creator to judge, blocked when something nobody in this channel can answer stops you. The framework posts the report mentioning the creator, which starts their turn once yours ends, so your reply need not mention them or repeat the report. You cannot close a unit yourself.',
      execute: async (args, context) => {
        const prepared = await context.tasks.prepareReport({
          actingAgentUsername: context.turn.agentUsername,
          channelId: context.turn.channelId,
          reference: args.reference,
          summary: args.summary,
          to: args.state
        });
        if (!prepared.success) {
          return refused(prepared.error);
        }
        const { addressee, prepared: transition, text } = prepared.value;
        return Result.ok({
          post: { addressee, onPublished: (postId) => context.tasks.commitTransition(transition, postId), text },
          text: `unit ${args.reference} reported ${args.state}; the report is posted to @${addressee}, whose turn starts when this turn ends, so your reply need not repeat it`
        });
      },
      parameters: z.object({
        reference: $OpenReference,
        state: z
          .enum(ASSIGNEE_TARGETS)
          .describe('review when the result is ready to be judged; blocked when you cannot go on'),
        summary: z.string().min(1).describe('What the creator should read first: the result, or what blocks you')
      }),
      traceDetail: (args) => `${args.reference} → ${args.state}`
    }
  }
});
