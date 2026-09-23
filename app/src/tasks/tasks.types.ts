import type { ModelRow, WorkUnitState } from '@/prisma/prisma.types.ts';

export type WorkUnit = ModelRow<'WorkUnit'>;

/** §3.15 — an assignment validated and rendered but not yet written: everything the row will hold, minus the post it waits for */
export type PreparedUnit = {
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly context: string;
  readonly creatorUsername: string;
  readonly criteria: string;
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

/** how a counterpart's state is worded for whoever reads it: the agent in its prompt, or a person in a listing */
export type CounterpartWording = {
  readonly formatMoment: (moment: Date) => string;
  /** false where the listing names a party's wait on a person itself (§8.4) */
  readonly namesPersonWait: boolean;
  /** the reader as owner of the awaited move: "your" to the agent, the agent's name to a person */
  readonly readerPossessive: string;
};

/** what the prompt block renders per unit (§3.15) */
export type OpenUnitSummary = {
  readonly assigneeUsername: string;
  readonly counterpart: CounterpartState;
  readonly createdAt: Date;
  readonly creatorUsername: string;
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
  type AssignRefused =
    | { assigneeUsername: string; kind: 'assignee-absent' }
    | { assigneeUsername: string; kind: 'assignee-cannot-report' }
    | { cap: number; kind: 'cap-reached' }
    | { kind: 'chain-limit' }
    | { kind: 'depth-limit' }
    | { kind: 'self-assignment' };
  type Unresolved = { kind: 'ambiguous' | 'not-found'; reference: string };
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
  type StateRefused =
    | TransitionRefused
    | { assigneeUsername: string; kind: 'not-the-assignee' }
    | { creatorUsername: string; kind: 'not-the-creator' };
  /** §3.15 — a close waits for the assignee's turn on the unit, and rests on the report it judges */
  type CloseRefused =
    | StateRefused
    | { assigneeUsername: string; kind: 'assignee-working'; reference: string }
    | { kind: 'report-unread'; reference: string };
  type Any = AssignRefused | CloseRefused | Unresolved;
}

export type TaskFailure = TaskFailure.Any;
