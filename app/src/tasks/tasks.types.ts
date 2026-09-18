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
export type PreparedTransition = {
  readonly to: Exclude<WorkUnitState, 'assigned'>;
  readonly unitId: string;
};

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
  type StateRefused =
    | { assigneeUsername: string; kind: 'not-the-assignee' }
    | { creatorUsername: string; kind: 'not-the-creator' }
    | { from: WorkUnitState; kind: 'illegal-transition'; to: WorkUnitState };
  type Any = AssignRefused | StateRefused | Unresolved;
}

export type TaskFailure = TaskFailure.Any;
