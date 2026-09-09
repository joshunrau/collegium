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
  'forget',
  'kill',
  'memory',
  'prompt',
  'queue',
  'reset',
  'resume',
  'stop',
  'trace',
  'triggers'
] as const;

export type CommandTrigger = (typeof COMMAND_TRIGGERS)[number];

export const COMMAND_DEFINITIONS: { readonly [T in CommandTrigger]: CommandDefinition } = {
  forget: { hint: '{post-id}', purpose: 'Remove a post from agent context' },
  kill: { hint: '', purpose: 'Abandon current turns in this channel immediately' },
  memory: { hint: '{agent} [prune {reference}]', purpose: "Inspect or prune an agent's memories" },
  prompt: { hint: '{agent}', purpose: "Show an agent's system prompt verbatim" },
  queue: { hint: '{agent}', purpose: 'Show pending depth and the oldest unprocessed post' },
  reset: { hint: '{agent}', purpose: 'Mark an episode boundary' },
  resume: { hint: '', purpose: 'Clear a global halt' },
  stop: { hint: '', purpose: 'Abort current turns in this channel at the next boundary' },
  trace: { hint: '{post-id}', purpose: 'Show the full tool trace for a turn' },
  triggers: { hint: '{agent}', purpose: 'List outstanding triggers' }
};

/** the one path the plugin forwards every execution to; the declaration composes APP_PUBLIC_URL with this */
export const COMMANDS_PATH = '/commands';

/** one subcommand as the plugin is told of it: what it autocompletes, in the order declared */
export type CommandDeclaration = {
  readonly hint: string;
  readonly purpose: string;
  readonly trigger: CommandTrigger;
};

export function describeCommandSurface(): readonly CommandDeclaration[] {
  return COMMAND_TRIGGERS.map((trigger) => ({ ...COMMAND_DEFINITIONS[trigger], trigger }));
}

/** what a human types, e.g. `/collegium stop` */
export function renderCommandName(trigger: CommandTrigger): string {
  return `/${COMMAND_TRIGGER} ${trigger}`;
}

export function renderUsage(trigger: CommandTrigger): string {
  return `Usage: ${renderCommandName(trigger)} ${COMMAND_DEFINITIONS[trigger].hint}`.trim();
}

/** the answer to a bare `/collegium`, or a subcommand nothing declares */
export function renderSurfaceUsage(): string {
  return [
    `Usage: /${COMMAND_TRIGGER} {subcommand}`,
    ...COMMAND_TRIGGERS.map((trigger) => {
      const { hint, purpose } = COMMAND_DEFINITIONS[trigger];
      return `- ${`${renderCommandName(trigger)} ${hint}`.trim()} — ${purpose}`;
    })
  ].join('\n');
}
