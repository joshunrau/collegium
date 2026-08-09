import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';

/** how a §7.5 command ends a running turn — the status it will close with */
export type AbortKind = Extract<TurnStatus, 'killed' | 'stopped'>;

export type Turn = ModelRow<'Turn'>;

/** what activation branches on when a turn ends: drain the queue, or leave it standing (§7.1) */
export type TurnOutcome = {
  readonly status: Exclude<TurnStatus, 'running'>;
  readonly turnId: string;
};

/** the payload union is the source of truth; `appendEvent` derives the `kind` column from it */
export type TurnEventInput = PrismaJson.TurnEventPayload;
