import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { ApprovalStatus } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { TurnEventInput } from '@/turns/turns.types.ts';

import { ApprovalsService } from '../approvals.service.ts';
import { ApprovalPendingRegistry } from '../decisions/approval-pending.registry.ts';

import type { DecisionInput } from '../approvals.types.ts';
import type { DecisionFailure, PendingCancellationReason } from '../decisions/decisions.types.ts';

/**
 * Golden table for the decision state machine: what one decision does to a pending approval, who
 * may make it (§3.7), and what it writes into the trace (§5.4, §7.5). The point is regression
 * detection: a change to the service shows up as a diff in exactly the rows it was meant to change.
 *
 * Rows are typed rather than loaded from a data file, so a row naming a status, a decision or a
 * refusal that does not exist is a compile error rather than a runtime failure nobody notices in a
 * passing suite.
 *
 * A row carrying `knownGap` freezes behaviour we intend to change. It passes today on purpose, and
 * a fix flips it, which is the visible proof. Do not add one to make a failing test pass; add one
 * only with the note that says who decided the behaviour is wrong and why it is still shipped.
 */
type ApprovalEventKind = Extract<TurnEventInput['kind'], `approval_${string}`>;

type DecisionRow = (
  | { readonly approver: 'bot' | 'member' | 'non-member'; readonly decision: DecisionInput['action'] }
  /** a cancellation has no approver: nobody decided anything (§7.5) */
  | { readonly decision: `cancel-${PendingCancellationReason}` }
) & {
  readonly expected: {
    /** appended by the decision alone: the request's own event is already in the trace */
    readonly appendedEventKinds: readonly ApprovalEventKind[];
    readonly promptRewritten: boolean;
    readonly refusal?: DecisionFailure['kind'];
    readonly status: ApprovalStatus;
  };
  readonly id: string;
  /** set only when the expectation freezes behaviour we intend to change */
  readonly knownGap?: string;
  readonly note: string;
  readonly priorStatus: Extract<ApprovalStatus, 'approved' | 'pending'>;
};

const ROWS: readonly DecisionRow[] = [
  {
    approver: 'member',
    decision: 'approve',
    expected: { appendedEventKinds: ['approval_decided'], promptRewritten: true, status: 'approved' },
    id: 'approve-by-member',
    note: 'a human present in the channel may approve, and the prompt is rewritten (§3.7)',
    priorStatus: 'pending'
  },
  {
    approver: 'member',
    decision: 'deny',
    expected: { appendedEventKinds: ['approval_decided'], promptRewritten: true, status: 'denied' },
    id: 'deny-by-member',
    note: 'a bare denial is terminal and is recorded as a denial (§5.4)',
    priorStatus: 'pending'
  },
  {
    approver: 'member',
    decision: 'deny-with-reason',
    expected: { appendedEventKinds: ['approval_decided'], promptRewritten: true, status: 'denied_with_reason' },
    id: 'deny-with-reason-by-member',
    note: 'a reasoned denial is its own terminal status, fed back to the turn (§5.4)',
    priorStatus: 'pending'
  },
  {
    approver: 'non-member',
    decision: 'approve',
    expected: {
      appendedEventKinds: [],
      promptRewritten: false,
      refusal: 'approver-not-present',
      status: 'pending'
    },
    id: 'approve-by-non-member-refused',
    note: 'presence confers authority, so a decision from outside the channel is refused (§3.7)',
    priorStatus: 'pending'
  },
  {
    approver: 'bot',
    decision: 'approve',
    expected: {
      appendedEventKinds: [],
      promptRewritten: false,
      refusal: 'approver-not-human',
      status: 'pending'
    },
    id: 'approve-by-bot-refused',
    note: 'any *human* present: presence alone is not authority (§3.7)',
    priorStatus: 'pending'
  },
  {
    approver: 'member',
    decision: 'approve',
    expected: {
      appendedEventKinds: [],
      promptRewritten: false,
      refusal: 'already-resolved',
      status: 'approved'
    },
    id: 'second-decision-refused',
    note: 'exactly one resolver wins a row; a later decision never re-applies (§3.7)',
    priorStatus: 'approved'
  },
  {
    decision: 'cancel-stop',
    expected: { appendedEventKinds: [], promptRewritten: true, status: 'invalidated' },
    id: 'stop-cancels-pending',
    note: 'a cancellation is not a denial, so no decision reaches the trace (§7.5)',
    priorStatus: 'pending'
  },
  {
    decision: 'cancel-kill',
    expected: { appendedEventKinds: [], promptRewritten: true, status: 'invalidated' },
    id: 'kill-cancels-pending',
    note: 'a cancellation is not a denial, so no decision reaches the trace (§7.5)',
    priorStatus: 'pending'
  },
  {
    decision: 'cancel-halt',
    expected: { appendedEventKinds: [], promptRewritten: true, status: 'invalidated' },
    id: 'halt-cancels-pending',
    note: 'a halt invalidates every pending prompt, as a restart does (§7.4)',
    priorStatus: 'pending'
  },
  {
    decision: 'cancel-stop',
    expected: { appendedEventKinds: [], promptRewritten: false, status: 'approved' },
    id: 'cancel-over-resolved-is-a-noop',
    note: 'the sweep claims pending rows only, so a resolved one keeps its ending (§7.5)',
    priorStatus: 'approved'
  }
];

type ApprovalRow = {
  decidedByUsername?: string;
  id: string;
  payloadText: string;
  promptPostId: null | string;
  reason?: string;
  status: ApprovalStatus;
  toolName: string;
  turnId: string;
};

const TURN = { agentUsername: 'mira', channelId: 'channel-1' };

const rowMessage = (row: DecisionRow): string => {
  return row.knownGap === undefined ? `${row.id}: ${row.note}` : `${row.id}: ${row.note} — knownGap: ${row.knownGap}`;
};

describe('the approval decision state machine', () => {
  let approvalsService: ApprovalsService;
  let events: TurnEventInput[];
  let rows: ApprovalRow[];
  let transport: MockedInstance<ChatTransport>;
  let updates: string[];

  beforeEach(async () => {
    events = [];
    updates = [];
    const table = createModelTable<ApprovalRow>({
      defaults: (sequence) => ({ id: `approval-${sequence}`, promptPostId: null }),
      relations: { turn: () => TURN }
    });
    rows = table.rows;
    transport = MockFactory.createMock(ChatTransport);
    transport.describeUser.mockResolvedValue(Result.ok({ isBot: false, username: 'casey' }));
    transport.isChannelMember.mockResolvedValue(Result.ok(true));
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(), postId: 'prompt-1' }));
    transport.maxPostSizeChars.mockResolvedValue(Result.ok(16_383));
    transport.updatePost.mockImplementation((postId) => {
      updates.push(postId);
      return Promise.resolve(Result.ok());
    });
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockImplementation((key) => (key === 'CALLBACK_TOKEN' ? 'a'.repeat(32) : 'http://localhost:3000'));
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    const multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.stripAgentMentions.mockImplementation((text: string) => text.replaceAll('@owen', 'owen'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        ApprovalPendingRegistry,
        CallbackSigner,
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: EnvService, useValue: envService },
        { provide: LoggingService, useValue: MockFactory.createMock(LoggingService) },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: getModelToken('Approval'), useValue: table }
      ]
    }).compile();
    approvalsService = moduleRef.get(ApprovalsService);
  });

  /** the pending approval every row decides on, at the status the row starts from; the box keeps the blocked request unawaited */
  const seed = async (row: DecisionRow): Promise<{ requested: Promise<unknown> }> => {
    const requested = approvalsService.request({
      agentUsername: 'mira',
      appendEvent: (event: TurnEventInput) => {
        events.push(event);
        return Promise.resolve();
      },
      args: { path: 'notes.md' },
      callId: 'call-1',
      channelId: 'channel-1',
      payloadPresentation: 'collapse',
      payloadText: 'write notes.md with 12 words',
      toolName: 'write',
      toolNamespace: 'workspace',
      turnId: 'turn-1'
    });
    await vi.waitFor(() => expect(rows.at(-1)?.promptPostId).toBeTruthy());
    if (row.priorStatus === 'approved') {
      await approvalsService.resolve(rows[0]!.id, { byUsername: 'casey', kind: 'approved' });
      await requested;
    }
    return { requested };
  };

  const decide = async (row: DecisionRow): Promise<DecisionFailure | undefined> => {
    if (!('approver' in row)) {
      if (row.decision === 'cancel-halt' || row.decision === 'cancel-restart') {
        await approvalsService.invalidateAll(row.decision === 'cancel-halt' ? 'halt' : 'restart');
        return undefined;
      }
      await approvalsService.cancelPendingIn('channel-1', row.decision === 'cancel-kill' ? 'kill' : 'stop');
      return undefined;
    }
    if (row.approver === 'bot') {
      transport.describeUser.mockResolvedValue(Result.ok({ isBot: true, username: 'mira' }));
    }
    if (row.approver === 'non-member') {
      transport.isChannelMember.mockResolvedValue(Result.ok(false));
    }
    const decider = { approvalId: rows[0]!.id, byUserId: 'casey-id', byUsername: 'casey' };
    const outcome =
      row.decision === 'deny-with-reason'
        ? await approvalsService.decideWithReason({ ...decider, reason: 'wrong file' })
        : await approvalsService.decide({ ...decider, action: row.decision });
    return outcome.success ? undefined : outcome.error;
  };

  it.each(ROWS)('$id: $note', async (row) => {
    const { requested } = await seed(row);
    const before = { events: events.length, updates: updates.length };
    const refusal = await decide(row);
    const actual = {
      appendedEventKinds: events.slice(before.events).map((event) => event.kind),
      promptRewritten: updates.length > before.updates,
      refusal: refusal?.kind,
      status: rows[0]!.status
    };
    expect(actual, rowMessage(row)).toStrictEqual({ refusal: undefined, ...row.expected });
    if (rows[0]!.status === 'pending') {
      await approvalsService.cancelPendingIn('channel-1', 'stop');
    }
    await requested;
  });
});
