import { implementToolset, TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import type { AgentRegistry } from '@/agents/agents.registry.ts';
import { AGENT_REGISTRY_TOKEN } from '@/agents/agents.tokens.ts';
import type { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import { TASKS_MOMENT_FORMATTER_TOKEN, TASKS_SERVICE_TOKEN } from './tasks.tokens.ts';
import {
  ASSIGNEE_TARGETS,
  createPartyNamer,
  CREATOR_TARGETS,
  renderTaskRefusal,
  renderUnitView,
  wordingForAgent
} from './tasks.utils.ts';

import type { TaskFailure, UnitWording } from './tasks.types.ts';

/** the two write verbs act on open units, which the prompt lists; a read reaches a closed one too (§3.15) */
const $OpenReference = z.string().min(1).describe('The reference of the work unit, as listed under Open work');

const $AnyReference = z
  .string()
  .min(1)
  .describe(
    'The reference of the work unit: from Open work, or from the post in this channel that assigned, reported or closed it'
  );

const refused = (failure: TaskFailure, wording: UnitWording) => {
  return Result.err({ kind: 'invalid-arguments' as const, message: renderTaskRefusal(failure, wording) });
};

/** the acting agent reads its units: a colleague by display name (§3.1), a moment in the operator's time */
const wordingFor = (context: {
  readonly agents: Pick<AgentRegistry, 'displayNameOf' | 'has'>;
  readonly moments: Pick<MomentFormatter, 'format'>;
}) => {
  const now = new Date();
  return wordingForAgent((moment) => context.moments.format(moment, now), createPartyNamer(context.agents));
};

/** §3.15 — every verb renders a post the framework publishes first, and writes only once told the post has landed */
export const TASKS_TOOLSET = implementToolset(TASKS_TOOLSET_DEF, {
  services: {
    agents: AGENT_REGISTRY_TOKEN,
    moments: TASKS_MOMENT_FORMATTER_TOKEN,
    tasks: TASKS_SERVICE_TOKEN
  },
  tools: {
    assign: {
      description:
        'Hand one unit of work to a colleague in this channel: the result you need, how you will judge it, and what they need to know. The framework posts it mentioning them, which starts their turn once yours ends, and records the unit. Their report is posted mentioning you and starts your turn once theirs ends, so a work order needs no instruction to mention you. Only you can close the unit. To go on with a unit of yours in review or blocked, name it in follows: the one post closes it as done and hands this unit to the same colleague. A question to a colleague is a post, not a unit.',
      execute: async (args, context) => {
        const wording = wordingFor(context);
        const prepared = await context.tasks.prepareAssign({
          actingAgentUsername: context.turn.agentUsername,
          assignees: context.settings.assignees,
          assigneeUsername: args.assignee,
          channelId: context.turn.channelId,
          context: args.context,
          criteria: args.criteria,
          follows: args.follows,
          openUnitCap: context.settings.openUnitCap,
          outcome: args.outcome,
          turnId: context.turn.turnId
        });
        if (!prepared.success) {
          return refused(prepared.error, wording);
        }
        const { addressee, prepared: unit, text } = prepared.value;
        const assigned = `unit ${renderReference(unit.id)} assigned to ${wording.nameOf(addressee)}, whose turn starts when this turn ends`;
        return Result.ok({
          post: { addressee, onPublished: (postId) => context.tasks.commitAssign(unit, postId), text },
          text:
            unit.followsId === null
              ? `${assigned}; the assignment is posted, so your reply need not repeat it`
              : `unit ${renderReference(unit.followsId)} closed as done and continued as ${assigned}; the post is in the channel, so your reply need not repeat it`
        });
      },
      parameters: z.object({
        assignee: z
          .string()
          .min(1)
          .describe('The colleague taking this on, by the handle beside their name under Peers, without the @'),
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
        follows: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The reference of a unit you handed to the same colleague that is in review or blocked, when this unit continues its work; you must have read its latest report. The post that assigns this unit closes that one as done.'
          ),
        outcome: z.string().min(1).describe('The result you need, stated as a result rather than as a step')
      }),
      traceDetail: (args) => {
        const follows = args.follows === undefined ? '' : `, following ${args.follows}`;
        return `@${args.assignee}${follows}: ${args.outcome}`;
      }
    },
    close: {
      description:
        'Close a unit you handed over, after reading the result: done when it meets your criteria, or when the report shows a criterion of yours could not be met from what you supplied, with that verdict; cancelled with the reason when the work will never be right. The framework posts the close, which mentions nobody. Only the creator closes a unit, and not while the assignee is still working on it or before you have read its latest report. To go on with its work under corrected criteria, call tasks__assign naming it in follows instead, which closes it as done.',
      execute: async (args, context) => {
        const wording = wordingFor(context);
        const prepared = await context.tasks.prepareClose({
          actingAgentUsername: context.turn.agentUsername,
          channelId: context.turn.channelId,
          reference: args.reference,
          to: args.state,
          turnId: context.turn.turnId,
          verdict: args.verdict
        });
        if (!prepared.success) {
          return refused(prepared.error, wording);
        }
        const { leavesNoneOpen, prepared: transition, text } = prepared.value;
        const closed = `unit ${args.reference} closed as ${args.state}; the close is posted, so your reply need not repeat it`;
        return Result.ok({
          post: { onPublished: (postId) => context.tasks.commitTransition(transition, postId), text },
          text: leavesNoneOpen
            ? `${closed}. You hold no other open unit in this channel; no turn of yours starts here until a post addresses you`
            : closed
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
        'Read one work unit in full: its outcome, criteria, context, parties and state, the unit it follows if it continues one, when it was assigned and last changed, where the other party stands now, and the post of its latest report or close. A report read here counts as read when you close the unit. A unit you created or were assigned in this channel reads whether it is open or closed.',
      execute: async (args, context) => {
        const wording = wordingFor(context);
        const view = await context.tasks.readView({
          agentUsername: context.turn.agentUsername,
          channelId: context.turn.channelId,
          reference: args.reference
        });
        if (!view.success) {
          return refused(view.error, wording);
        }
        const { latestChange } = view.value;
        if (latestChange.kind === 'posted') {
          // §3.15 — a report shown here is one a close may rest on
          context.tasks.recordPostsRead(context.turn.turnId, [latestChange.post.id]);
        }
        return Result.ok({ text: renderUnitView(view.value, context.turn.agentUsername, wording) });
      },
      parameters: z.object({ reference: $AnyReference }),
      retryable: true,
      traceDetail: (args) => args.reference
    },
    report: {
      description:
        'Report on a unit handed to you: review when the result is ready for its creator to judge, blocked when something nobody in this channel can answer stops you. The framework posts the report mentioning the creator, which starts their turn once yours ends, so your reply need not mention them or repeat the report. Until you report, a post of yours starts their turn only if it mentions them. You cannot close a unit yourself, and one in review takes no further report: it is with its creator.',
      execute: async (args, context) => {
        const wording = wordingFor(context);
        const prepared = await context.tasks.prepareReport({
          actingAgentUsername: context.turn.agentUsername,
          channelId: context.turn.channelId,
          reference: args.reference,
          summary: args.summary,
          to: args.state
        });
        if (!prepared.success) {
          return refused(prepared.error, wording);
        }
        const { addressee, prepared: transition, text } = prepared.value;
        return Result.ok({
          post: { addressee, onPublished: (postId) => context.tasks.commitTransition(transition, postId), text },
          text: `unit ${args.reference} reported ${args.state}; the report is posted to ${wording.nameOf(addressee)}, whose turn starts when this turn ends, so your reply need not repeat it`
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
