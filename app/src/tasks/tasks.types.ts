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

/** what the prompt block renders per unit (§3.15) */
export type OpenUnitSummary = {
  readonly assigneeUsername: string;
  readonly createdAt: Date;
  readonly creatorUsername: string;
  readonly outcome: string;
  readonly reference: string;
  readonly state: WorkUnitState;
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
