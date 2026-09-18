import { describe, expect, it } from 'vitest';

import type { ActivationSource } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';

import { toActivationChainLength, toActivationDepth } from '../activation.utils.ts';

/**
 * Golden table for §7.4's depth and chain length. The point is regression detection: a change to
 * the activation rules shows up as a diff in exactly the rows it was meant to change.
 *
 * Rows are typed rather than loaded from a data file, so a row naming an `ActivationSource` shape
 * that cannot occur is a compile error rather than a runtime failure nobody notices in a passing
 * suite.
 *
 * A row carrying `knownGap` freezes behaviour we intend to change. It passes today on purpose, and
 * a fix flips it, which is the visible proof. Do not add one to make a failing test pass; add one
 * only with the note that says who decided the behaviour is wrong and why it is still shipped.
 *
 * `parentDepth` and `parentChainLength` are read off one `authoringTurn`, whose own columns are
 * both non-null, so no row states one without the other: the cell cannot be reached.
 */
type DepthChainRow = {
  readonly activatedAgent: string;
  readonly expected: { readonly chainLength: number; readonly depth: number };
  readonly id: string;
  readonly knownGap?: string;
  readonly note: string;
  /** undefined models a post whose authoring turn could not be recovered at all */
  readonly source: ActivationSource | undefined;
};

const sourceFrom = (authorKind: AuthorKind, fields: Partial<ActivationSource> = {}): ActivationSource => ({
  authorKind,
  authorUsername: 'owen',
  delegator: undefined,
  parentChainLength: undefined,
  parentDepth: undefined,
  parentRootPostId: undefined,
  ...fields
});

const PARENT = { parentChainLength: 2, parentDepth: 1 };

const ROWS: readonly DepthChainRow[] = [
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 0 },
    id: 'no-source',
    note: 'an unrecoverable origin is treated as a fresh human ask (§7.4)',
    source: undefined
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 0 },
    id: 'human-bare',
    note: 'a human-initiated turn starts at depth zero, chain one (§7.4)',
    source: sourceFrom('human')
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 0 },
    id: 'human-with-parent-fields',
    note: 'the author kind is read first, so parent fields never reach a human turn (§7.4)',
    source: sourceFrom('human', { ...PARENT, delegator: { agentUsername: 'mira', depth: 4 } })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 1 },
    id: 'system-bare',
    note: 'a trigger-initiated turn starts at depth one: a cron is not a human (§7.4)',
    source: sourceFrom('system', { authorUsername: 'collegium' })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 1 },
    id: 'system-with-parent-fields',
    note: 'the same short-circuit holds for the system bot (§7.4)',
    source: sourceFrom('system', {
      ...PARENT,
      authorUsername: 'collegium',
      delegator: { agentUsername: 'mira', depth: 4 }
    })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 1, depth: 1 },
    id: 'agent-no-authoring-turn',
    note: 'an agent mention whose authoring turn is unrecoverable nests one level from nothing (§7.4)',
    source: sourceFrom('agent')
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 5, depth: 5 },
    id: 'agent-no-delegator',
    note: 'a hand-off from a turn answering nobody the framework knows: parent plus one on both (§7.4)',
    source: sourceFrom('agent', { parentChainLength: 4, parentDepth: 4 })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 3, depth: 0 },
    id: 'agent-returning-delegator',
    note: 'a return takes the delegating turn’s depth while the chain still lengthens (§7.4)',
    source: sourceFrom('agent', { ...PARENT, delegator: { agentUsername: 'mira', depth: 0 } })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 3, depth: 3 },
    id: 'agent-returning-delegator-deeper',
    note: 'a return takes that turn’s own depth, not zero (§7.4)',
    source: sourceFrom('agent', { ...PARENT, delegator: { agentUsername: 'mira', depth: 3 } })
  },
  {
    activatedAgent: 'mira',
    expected: { chainLength: 3, depth: 2 },
    id: 'agent-other-delegator',
    note: 'a mention from a turn another agent activated is a hand-off, not a return (§7.4)',
    source: sourceFrom('agent', { ...PARENT, delegator: { agentUsername: 'omar', depth: 0 } })
  }
];

const rowMessage = (row: DepthChainRow): string => {
  return row.knownGap === undefined ? `${row.id}: ${row.note}` : `${row.id}: ${row.note} — knownGap: ${row.knownGap}`;
};

describe('activation depth and chain length', () => {
  it.each(ROWS)('$id: $note', (row) => {
    const actual = {
      chainLength: toActivationChainLength(row.source),
      depth: toActivationDepth(row.source, row.activatedAgent)
    };
    expect(actual, rowMessage(row)).toStrictEqual(row.expected);
  });
});
