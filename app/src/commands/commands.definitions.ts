import type { SubcommandDeclaration } from '@collegium/mattermost';

type CommandDefinition = {
  /** argument shape after the subcommand — drives the autocomplete hint and usage refusals; '' when none */
  readonly hint: string;
  /** one line for Mattermost's autocomplete help */
  readonly purpose: string;
};

/** the one slash command the Mattermost plugin registers; every command below is a subcommand of it */
export const COMMAND_TRIGGER = 'collegium';

/** the §8.4 command surface — the one list every other representation derives from */
export const COMMAND_TRIGGERS = [
  'approvals',
  'forget',
  'inspect',
  'kill',
  'memory',
  'queue',
  'reset',
  'resume',
  'steer',
  'stop',
  'trace',
  'triggers',
  'usage'
] as const;

export type CommandTrigger = (typeof COMMAND_TRIGGERS)[number];

export const COMMAND_DEFINITIONS: { readonly [T in CommandTrigger]: CommandDefinition } = {
  approvals: { hint: '[agent]', purpose: 'List approvals waiting on a human' },
  forget: { hint: '{post-id}', purpose: 'Remove a post from agent context' },
  inspect: { hint: '{agent}', purpose: "Show an agent's model, tools, skills and system prompt" },
  kill: { hint: '', purpose: 'Abandon current turns in this channel immediately' },
  memory: {
    hint: '{agent} [show {reference} | prune {reference}]',
    purpose: "List, read or prune an agent's memories"
  },
  queue: { hint: '{agent} [clear]', purpose: 'Show pending depth, or discard the standing queue entry' },
  reset: { hint: '{agent}', purpose: 'Mark an episode boundary' },
  resume: { hint: '', purpose: 'Clear a global halt' },
  steer: { hint: '{text}', purpose: 'Hand one instruction to the turns running in this channel' },
  stop: { hint: '', purpose: 'Abort current turns in this channel at the next boundary' },
  trace: { hint: '{post-id}', purpose: 'Show the full tool trace for a turn' },
  triggers: { hint: '{agent}', purpose: 'List outstanding triggers' },
  usage: { hint: '', purpose: 'Show token usage per agent and model over the last 24 hours' }
};

/** the one path the plugin forwards every execution to; the declaration composes APP_PUBLIC_URL with this */
export const COMMANDS_PATH = '/commands';

/** one subcommand as the plugin is told of it, with the trigger narrowed to the declared set */
export type CommandDeclaration = Omit<SubcommandDeclaration, 'trigger'> & { readonly trigger: CommandTrigger };

export function describeCommandSurface(): readonly CommandDeclaration[] {
  return COMMAND_TRIGGERS.map((trigger) => ({ ...COMMAND_DEFINITIONS[trigger], trigger }));
}

/** what a human types, e.g. `/collegium stop` */
export function renderCommandName(trigger: CommandTrigger): string {
  return `/${COMMAND_TRIGGER} ${trigger}`;
}

/** the command name followed by its argument hint, e.g. `/collegium memory {agent} [prune {reference}]` */
export function renderInvocation(trigger: CommandTrigger): string {
  return `${renderCommandName(trigger)} ${COMMAND_DEFINITIONS[trigger].hint}`.trim();
}

export function renderUsage(trigger: CommandTrigger): string {
  return `Usage: ${renderInvocation(trigger)}`;
}

/** the answer to a bare `/collegium`, or a subcommand nothing declares */
export function renderSurfaceUsage(): string {
  return [
    `Usage: /${COMMAND_TRIGGER} {subcommand}`,
    ...COMMAND_TRIGGERS.map((trigger) => `- ${renderInvocation(trigger)} — ${COMMAND_DEFINITIONS[trigger].purpose}`)
  ].join('\n');
}
