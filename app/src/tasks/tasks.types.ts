import type { ModelRow, WorkUnitState } from '@/prisma/prisma.types.ts';

export type WorkUnit = ModelRow<'WorkUnit'>;

/** §3.15 — an assignment validated and rendered but not yet written: everything the row will hold, minus the post it waits for */
export type PreparedUnit = {
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly context: string;
  readonly creatorUsername: string;
  readonly criteria: string;
  /** the unit this one continues, which the same post closes as done; null for a fresh hand-off */
  readonly followsId: null | string;
  /** minted before the post so the post can carry the reference; the row is created under this id */
  readonly id: string;
  readonly outcome: string;
};

/** §3.15 — a transition validated against the row as it was read; committed only against the row as it is when the post has landed */
export type PreparedTransition =
  | {
      /** who closes it, recorded with the close; a refused report names them */
      readonly closedByUsername?: string;
      readonly to: Extract<WorkUnitState, 'cancelled' | 'done'>;
      readonly unitId: string;
      readonly verdict?: string;
    }
  | { readonly to: Extract<WorkUnitState, 'blocked' | 'review'>; readonly unitId: string };

export type OpenUnitState = Exclude<WorkUnitState, 'cancelled' | 'done'>;

/** §3.15 — what an open unit waits on: its assignee's report while assigned, its creator's verdict once reported */
export type AwaitedMove = 'report' | 'verdict';

/** a person a running turn is parked on (§3.7, §3.7a), and since when */
export type PersonWait = {
  readonly on: 'approval' | 'ask';
  readonly since: Date;
};

/** §3.15 — where the other party to an open unit stands for the agent reading it; computed each time it is shown, never stored */
export type CounterpartState =
  /** the counterpart holds the lane here (§5.1): since when, whether that turn began before the unit last changed, and any person it waits on */
  | {
      readonly awaited: AwaitedMove;
      readonly beganBeforeChange: boolean;
      readonly kind: 'in-turn';
      readonly since: Date;
      readonly waitingOn: PersonWait | undefined;
    }
  /** the latest turn the counterpart began here since the unit last changed has ended, without the move */
  | { readonly awaited: AwaitedMove; readonly endedAt: Date; readonly kind: 'turn-ended' }
  /** the move is the reader's own, and the counterpart has waited on it since the unit last changed */
  | { readonly awaited: AwaitedMove; readonly kind: 'awaiting-reader'; readonly since: Date }
  | { readonly awaited: AwaitedMove; readonly kind: 'no-turn' };

/** how a unit's text names one of its parties, or whoever closed it, in prose */
export type PartyNamer = (username: string) => string;

/** how a unit's line, record and refusals are worded for whoever reads them: the agent itself, or a person in a listing */
export type UnitWording = {
  readonly formatMoment: (moment: Date) => string;
  readonly nameOf: PartyNamer;
  /** false where the listing names a party's wait on a person itself (§8.4) */
  readonly namesPersonWait: boolean;
  /** the agent whose units they are, as owner: "your" to the agent, its name to a person */
  readonly readerPossessive: string;
};

/** what the prompt block renders per unit (§3.15) */
export type OpenUnitSummary = {
  readonly assigneeUsername: string;
  readonly counterpart: CounterpartState;
  readonly createdAt: Date;
  readonly creatorUsername: string;
  /** the reference of the unit this one continues, if it continues one */
  readonly follows: string | undefined;
  readonly outcome: string;
  readonly reference: string;
  readonly state: OpenUnitState;
};

/** a post of a unit as agent context may show it (§8.4) */
export type UnitPost = {
  readonly createdAt: Date;
  readonly id: string;
  readonly message: string;
};

/** §3.15 — the post of a unit's latest change: none while it is only assigned, else that post, or word that it was forgotten (§8.4) */
export type LatestChange =
  { readonly kind: 'none' } | { readonly kind: 'posted'; readonly post: UnitPost } | { readonly kind: 'unreadable' };

/** §3.15 — what tasks::read shows: the record, where the counterpart stands while it is open, and its latest change */
export type UnitView = {
  readonly counterpart: CounterpartState | undefined;
  readonly latestChange: LatestChange;
  readonly unit: WorkUnit;
};

export declare namespace TaskFailure {
  /** §7.2 — a reference that matches nothing names the ones the agent was shown under Open work */
  type Unresolved =
    | { kind: 'ambiguous'; reference: string }
    | { kind: 'not-found'; openReferences: readonly string[]; reference: string };
  /** §3.15 — a closed unit takes no transition, and says who closed it, when, and the verdict */
  type Closed = {
    closedAt: Date;
    closedByUsername: null | string;
    kind: 'closed';
    reference: string;
    state: Extract<WorkUnitState, 'cancelled' | 'done'>;
    verdict: null | string;
  };
  type TransitionRefused = Closed | { from: WorkUnitState; kind: 'illegal-transition'; to: WorkUnitState };
  type NotTheCreator = { creatorUsername: string; kind: 'not-the-creator' };
  /** §3.15 — a verdict rests on the report it judges, so this turn must have read it */
  type ReportUnread = { kind: 'report-unread'; reference: string };
  type StateRefused = NotTheCreator | TransitionRefused | { assigneeUsername: string; kind: 'not-the-assignee' };
  /** §3.15 — a report the unit cannot take names the creator it is with and the way on */
  type ReportRefused =
    | StateRefused
    | { closed: Closed; creatorUsername: string; kind: 'report-closed' }
    | {
        creatorUsername: string;
        kind: 'awaiting-verdict';
        reference: string;
        state: Extract<WorkUnitState, 'blocked' | 'review'>;
      };
  /** §3.15 — a close waits for the assignee's turn on the unit, and rests on the report it judges */
  type CloseRefused =
    ReportUnread | StateRefused | { assigneeUsername: string; kind: 'assignee-working'; reference: string };
  /** §3.15 — only the creator continues a unit, once its report is in and read, and only to the same assignee */
  type ContinueRefused =
    | NotTheCreator
    | ReportUnread
    | Unresolved
    | { assigneeUsername: string; kind: 'follows-other-assignee'; reference: string }
    | { kind: 'not-continuable'; reference: string; state: Exclude<WorkUnitState, 'blocked' | 'review'> };
  type AssignRefused =
    | ContinueRefused
    | { assigneeUsername: string; kind: 'assignee-absent' }
    | { assigneeUsername: string; kind: 'assignee-cannot-report' }
    | { cap: number; kind: 'cap-reached' }
    | { kind: 'chain-limit' }
    | { kind: 'depth-limit' }
    | { kind: 'self-assignment' };
  type Any = AssignRefused | CloseRefused | ReportRefused | Unresolved;
}

export type TaskFailure = TaskFailure.Any;
