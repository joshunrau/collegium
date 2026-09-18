import { $PluginTool, toFrameworkTool } from '@collegium/core/plugins';
import { renderToolDisplayName, renderToolWireName } from '@collegium/core/tools';
import type { ToolId } from '@collegium/core/tools';
import { FRAMEWORK_TOOLSET_DEFS } from '@collegium/core/toolsets';
import type { AnyToolset, ToolGrant, ToolRefsOf, ToolRefsOfDef } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { AsksService } from '@/approvals/asks.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope } from '@/testing/factories/tool-turn.factory.ts';

import { ToolExecutor } from '../tools.executor.ts';
import { ToolRegistry } from '../tools.registry.ts';
import { FRAMEWORK_TOOLSETS } from '../tools.toolsets.ts';
import { registerToolset } from '../tools.utils.ts';

import type { ToolAttempt } from '../tools.types.ts';

/**
 * Golden table for the gate: which of an agent's granted tools can act without a human (§3.4). The
 * point is regression detection: a toolset that changes its gate shows up as a diff in exactly the
 * rows it was meant to change, and a framework tool with no row at all fails the last case here.
 *
 * Rows are typed rather than loaded from a data file, so a row naming a tool or a grant that does
 * not exist is a compile error rather than a runtime failure nobody notices in a passing suite.
 *
 * A row carrying `knownGap` freezes behaviour we intend to change. It passes today on purpose, and
 * a fix flips it, which is the visible proof. Do not add one to make a failing test pass; add one
 * only with the note that says who decided the behaviour is wrong and why it is still shipped.
 */

/** a plugin's own toolset as the assembler builds it: every tool through the §3.14 perimeter */
const BOOKMARK_TOOLSET = {
  name: 'bookmark',
  tools: {
    list: toFrameworkTool(
      $PluginTool.parse({
        approval: null,
        description: 'List the saved bookmarks.',
        execute: () => 'nothing saved',
        parameters: z.object({})
      })
    ),
    save: toFrameworkTool(
      $PluginTool.parse({
        approval: (args: { url: string }) => ({ body: `save ${args.url}`, presentation: 'collapse' }),
        description: 'Save a bookmark.',
        execute: () => 'saved',
        parameters: z.object({ url: z.url() })
      })
    )
  }
} as const satisfies AnyToolset;

type PluginGrant = (typeof BOOKMARK_TOOLSET)['name'] | ToolRefsOf<typeof BOOKMARK_TOOLSET>;

type ToolRef = ToolRefsOf<typeof BOOKMARK_TOOLSET> | ToolRefsOfDef<(typeof FRAMEWORK_TOOLSET_DEFS)[number]>;

type WireNameOf<TRef extends string> = TRef extends `${infer TNamespace}::${infer TName}`
  ? `${TNamespace}__${TName}`
  : never;

/** what the model would emit, in either spelling: the registry admits both (§3.4) */
type CallName = ToolRef | WireNameOf<ToolRef>;

/** `asks` is the third answer §3.7a adds: no consent decision, no body, a question the human answers */
type GateOutcome = 'asks' | 'gated' | 'invalid-arguments' | 'ungated' | 'unresolved-tool';

type GateRow = (
  | { readonly args: unknown; readonly call: CallName; readonly expected: Exclude<GateOutcome, 'unresolved-tool'> }
  | { readonly args?: unknown; readonly call: string; readonly expected: 'unresolved-tool' }
) & {
  readonly grants: readonly (PluginGrant | ToolGrant)[];
  readonly id: string;
  /** set only when the expectation freezes behaviour we intend to change */
  readonly knownGap?: string;
  readonly note: string;
};

const OUTBOUND = { body: 'the whole body', subject: 'the subject', to: ['casey@example.com'] };

const ROWS: readonly GateRow[] = [
  {
    args: { question: 'which airport?' },
    call: 'ask__human',
    expected: 'asks',
    grants: ['ask'],
    id: 'ask-human-asks',
    note: 'a question to the channel is neither gated nor unattended: the answer is the result (§3.7a)'
  },
  {
    args: { assignee: 'owen', context: 'x', criteria: 'y', outcome: 'z' },
    call: 'tasks__assign',
    expected: 'ungated',
    grants: ['tasks'],
    id: 'tasks-assign-ungated',
    note: 'a hand-off is not more consequential than the mention it replaces (§3.15)'
  },
  {
    args: { reference: 'abcd1234', state: 'done', verdict: 'good' },
    call: 'tasks__close',
    expected: 'ungated',
    grants: ['tasks'],
    id: 'tasks-close-ungated',
    note: 'the unit is not a second approval surface (§3.15)'
  },
  {
    args: { reference: 'abcd1234' },
    call: 'tasks__read',
    expected: 'ungated',
    grants: ['tasks'],
    id: 'tasks-read-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: { reference: 'abcd1234', state: 'review', summary: 'done' },
    call: 'tasks__report',
    expected: 'ungated',
    grants: ['tasks'],
    id: 'tasks-report-ungated',
    note: 'the unit is not a second approval surface (§3.15)'
  },
  {
    args: {},
    call: 'builtins__now',
    expected: 'ungated',
    grants: [],
    id: 'builtins-now-ungated-without-grant',
    note: 'a core tool is in every agent’s set and reads the clock (§3.4)'
  },
  {
    args: { name: 'triage' },
    call: 'skills__load',
    expected: 'ungated',
    grants: [],
    id: 'skills-load-ungated',
    note: 'loading a skill the agent was already assigned is framework machinery (§3.4)'
  },
  {
    args: { id: 'trigger-1' },
    call: 'triggers__resolve',
    expected: 'ungated',
    grants: [],
    id: 'triggers-resolve-ungated',
    note: 'clearing a trigger the framework itself raised is framework machinery (§3.4)'
  },
  {
    args: { query: 'the budget' },
    call: 'conversations__search',
    expected: 'ungated',
    grants: ['conversations'],
    id: 'conversations-search-ungated',
    note: 'a read across the channels the roster allows is still a read (§3.4, §3.8)'
  },
  {
    args: { ref: 'm-1' },
    call: 'mail__conversation',
    expected: 'ungated',
    grants: ['mail'],
    id: 'mail-conversation-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: {},
    call: 'mail__list',
    expected: 'ungated',
    grants: ['mail'],
    id: 'mail-list-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: { ref: 'm-1' },
    call: 'mail__open',
    expected: 'ungated',
    grants: ['mail'],
    id: 'mail-open-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: { query: 'invoice' },
    call: 'mail__search',
    expected: 'ungated',
    grants: ['mail'],
    id: 'mail-search-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: { ...OUTBOUND, ref: 'm-1' },
    call: 'mail__reply',
    expected: 'gated',
    grants: ['mail'],
    id: 'mail-reply-gates',
    note: 'anything externally visible carries approval; the payload is the review (§3.4, §6.3)'
  },
  {
    args: OUTBOUND,
    call: 'mail__send',
    expected: 'gated',
    grants: ['mail'],
    id: 'mail-send-gates',
    note: 'anything externally visible carries approval; the payload is the review (§3.4, §6.3)'
  },
  {
    args: { reference: 'a1b2c3d4', text: 'and prefers mornings' },
    call: 'memory__append',
    expected: 'ungated',
    grants: ['memory'],
    id: 'memory-append-ungated',
    note: 'a revision inherits the write’s exemption from A5 (§3.6)'
  },
  {
    args: { reference: 'a1b2c3d4' },
    call: 'memory__delete',
    expected: 'ungated',
    grants: ['memory'],
    id: 'memory-delete-ungated',
    note: 'deletion inherits the write’s exemption from A5 (§3.6)'
  },
  {
    args: { reference: 'a1b2c3d4' },
    call: 'memory__read',
    expected: 'ungated',
    grants: ['memory'],
    id: 'memory-read-ungated',
    note: 'reads are ungated (§3.4)'
  },
  {
    args: { passage: 'a phone call', reference: 'a1b2c3d4', replacement: 'email' },
    call: 'memory__replace',
    expected: 'ungated',
    grants: ['memory'],
    id: 'memory-replace-ungated',
    note: 'a revision inherits the write’s exemption from A5 (§3.6)'
  },
  {
    args: { body: 'casey prefers a phone call', description: 'how casey likes to be reached' },
    call: 'memory__write',
    expected: 'ungated',
    grants: ['memory'],
    id: 'memory-write-ungated',
    note: 'the single stated exception to A5 (§3.6)'
  },
  {
    args: { command: 'id -un' },
    call: 'shell__run',
    expected: 'gated',
    grants: ['shell'],
    id: 'shell-run-gates',
    note: 'model-authored text on the host gates on every command (§3.4, §A2)'
  },
  {
    args: { ref: 'e1' },
    call: 'web__click',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-click-ungated',
    note: 'browsing is the widest ungated surface, named as such (§3.4)'
  },
  {
    args: { url: 'https://example.com' },
    call: 'web__fetch',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-fetch-ungated',
    note: 'browsing is the widest ungated surface, named as such (§3.4)'
  },
  {
    args: { ref: 'e1', text: 'hello' },
    call: 'web__fill',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-fill-ungated',
    note: 'signing in is ungated; masking the text is the compensating control (§3.4)'
  },
  {
    args: { ref: 'e1' },
    call: 'web__hover',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-hover-ungated',
    note: 'browsing is the widest ungated surface, named as such (§3.4)'
  },
  {
    args: { url: 'https://example.com' },
    call: 'web__navigate',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-navigate-ungated',
    note: 'browsing is the widest ungated surface, named as such (§3.4)'
  },
  {
    args: { query: 'collegium' },
    call: 'web__search',
    expected: 'ungated',
    grants: ['web'],
    id: 'web-search-ungated',
    note: 'ranked summaries are a read; the provider is fixed in settings (§3.4)'
  },
  {
    args: { namePattern: '*.md' },
    call: 'workspace__find',
    expected: 'ungated',
    grants: ['workspace'],
    id: 'workspace-find-ungated',
    note: 'reads inside the confinement are ungated (§3.4, §6.1)'
  },
  {
    args: { pattern: 'TODO' },
    call: 'workspace__grep',
    expected: 'ungated',
    grants: ['workspace'],
    id: 'workspace-grep-ungated',
    note: 'reads inside the confinement are ungated (§3.4, §6.1)'
  },
  {
    args: {},
    call: 'workspace__list',
    expected: 'ungated',
    grants: ['workspace'],
    id: 'workspace-list-ungated',
    note: 'reads inside the confinement are ungated (§3.4, §6.1)'
  },
  {
    args: { path: 'notes.md' },
    call: 'workspace__read',
    expected: 'ungated',
    grants: ['workspace'],
    id: 'workspace-read-ungated',
    note: 'reads inside the confinement are ungated (§3.4, §6.1)'
  },
  {
    args: { path: 'notes.md' },
    call: 'workspace__stat',
    expected: 'ungated',
    grants: ['workspace'],
    id: 'workspace-stat-ungated',
    note: 'reads inside the confinement are ungated (§3.4, §6.1)'
  },
  {
    args: { content: 'the file', path: 'notes.md' },
    call: 'workspace__write',
    expected: 'gated',
    grants: ['workspace'],
    id: 'workspace-write-gates',
    note: 'a write inside the confinement still gates on its content (§3.4, §6.2)'
  },
  {
    args: OUTBOUND,
    call: 'mail::send',
    expected: 'gated',
    grants: ['mail'],
    id: 'display-spelling-resolves',
    note: 'the display spelling the framework’s own posts show resolves to the same tool (§3.4)'
  },
  {
    args: {},
    call: 'shell__run',
    expected: 'unresolved-tool',
    grants: ['mail'],
    id: 'ungranted-tool-unresolved',
    note: 'the map holds only the tools the agent was granted (§3.4, §6.1)'
  },
  {
    call: 'not__a_tool',
    expected: 'unresolved-tool',
    grants: [],
    id: 'unknown-tool-unresolved',
    note: 'a name claiming no granted tool ends the turn (§6.1, §7.2)'
  },
  {
    args: {},
    call: 'shell__run',
    expected: 'invalid-arguments',
    grants: ['shell'],
    id: 'malformed-args-before-gate',
    note: 'the parse precedes the gate, so malformed arguments never reach a human (§5)'
  },
  {
    args: OUTBOUND,
    call: 'mail__send',
    expected: 'unresolved-tool',
    grants: ['mail::search'],
    id: 'single-tool-ref-grants-only-it',
    note: 'a ref grants that tool alone, never its namespace (§3.4)'
  },
  {
    args: { url: 'https://example.com' },
    call: 'bookmark__save',
    expected: 'gated',
    grants: ['bookmark'],
    id: 'plugin-gated-tool-gates',
    note: 'a plugin tool stating a render function gates like any other (§3.14)'
  },
  {
    args: {},
    call: 'bookmark__list',
    expected: 'ungated',
    grants: ['bookmark'],
    id: 'plugin-ungated-tool-runs',
    note: 'a plugin tool stating `approval: null` runs unattended; plugin trust is total (§3.14, §9)'
  }
];

/**
 * Every declared service refuses to be reached, so a tool body that got past the gate fails the
 * same way whatever it does: the table reads whether consent was asked for, never what a vendor
 * would have answered.
 */
const REFUSING_SERVICE = new Proxy(
  {},
  {
    get: (_target, property) => {
      throw new Error(`a tool body reached the stubbed service "${String(property)}"`);
    }
  }
);

const LIBRARY = [...FRAMEWORK_TOOLSETS, BOOKMARK_TOOLSET].map((declaration) => {
  return registerToolset(
    declaration,
    () => REFUSING_SERVICE,
    () => {
      throw new Error('no toolset in this table declares storage');
    }
  );
});

/** every setting a framework tool declares `isAvailableWith` over, so a namespace grant leaves nothing out */
const TOOL_SETTINGS: ReadonlyMap<string, unknown> = new Map([
  ['tasks', { openUnitCap: 20, shownInPrompt: 20 }],
  ['web', { search: { provider: { apiKey: 'a-key', kind: 'brave' } } }]
]);

const toOutcome = (attempt: ToolAttempt, requestedApproval: boolean, asked: boolean): GateOutcome => {
  if (requestedApproval) {
    return 'gated';
  }
  if (asked) {
    return 'asks';
  }
  if (attempt.kind === 'terminal' && attempt.detail.startsWith('no tool named ')) {
    return 'unresolved-tool';
  }
  if (attempt.kind === 'continue' && attempt.output.startsWith('invalid arguments for ')) {
    return 'invalid-arguments';
  }
  return 'ungated';
};

const rowMessage = (row: GateRow): string => {
  return row.knownGap === undefined ? `${row.id}: ${row.note}` : `${row.id}: ${row.note} — knownGap: ${row.knownGap}`;
};

describe('the tool gate', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let asksService: MockedInstance<AsksService>;

  beforeEach(() => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    // denied, so the table never runs the body of a tool a human would have had to consent to
    approvalsService.request.mockResolvedValue(Result.ok({ byUsername: 'casey', kind: 'denied' }));
    asksService = MockFactory.createMock(AsksService);
    asksService.request.mockResolvedValue(Result.ok({ kind: 'cancelled', reason: 'stop' }));
  });

  const run = async (row: GateRow): Promise<GateOutcome> => {
    const profile = buildAgentProfile({ tools: [...row.grants], toolSettings: TOOL_SETTINGS });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolExecutor,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: AsksService, useValue: asksService },
        { provide: ToolRegistry, useValue: new ToolRegistry(LIBRARY, [profile]) }
      ]
    }).compile();
    const attempt = await moduleRef.get(ToolExecutor).execute({
      appendEvent: () => Promise.resolve(),
      call: { arguments: row.args ?? {}, id: 'call-1', name: row.call },
      contextText: 'Action 1 of 25',
      profile,
      turn: buildToolTurnScope()
    });
    return toOutcome(
      attempt,
      approvalsService.request.mock.calls.length > 0,
      asksService.request.mock.calls.length > 0
    );
  };

  it.each(ROWS)('$id: $note', async (row) => {
    expect(await run(row), rowMessage(row)).toBe(row.expected);
  });

  it('holds a row for every framework tool, so a new one cannot ship without stating its gate (§3.4)', () => {
    const calls = new Set<string>(ROWS.map((row) => row.call));
    const ids = FRAMEWORK_TOOLSET_DEFS.flatMap((def) => def.tools.map((tool): ToolId => [def.name, tool]));
    const uncovered = ids.filter((id) => !calls.has(renderToolWireName(id)) && !calls.has(renderToolDisplayName(id)));
    expect(uncovered).toStrictEqual([]);
  });
});
