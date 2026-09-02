type CommandDefinition = {
  /** argument shape after the trigger — drives the autocomplete hint and usage refusals; '' when none */
  readonly hint: string;
  /** one line for Mattermost's description and autocomplete fields */
  readonly purpose: string;
};

function renderSubcommand(trigger: CommandTrigger): string {
  const hint = COMMAND_DEFINITIONS[trigger].hint;
  return hint ? `${trigger} ${hint}` : trigger;
}

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

/** the single Mattermost trigger — every §8.4 command is a subcommand of `/collegium` */
export const COMMAND_TRIGGER = 'collegium';

/** what Mattermost shows beside `/collegium` in its command list */
export const COMMAND_DESCRIPTION = 'Collegium operator commands';

/** the one path every slash command posts to; registration composes APP_PUBLIC_URL with this */
export const COMMANDS_PATH = '/commands';

/** the autocomplete hint Mattermost shows once `/collegium ` is typed: every subcommand and its arguments */
export function renderAutocompleteHint(): string {
  return COMMAND_TRIGGERS.map(renderSubcommand).join(' | ');
}

export function renderUsage(trigger: CommandTrigger): string {
  return `Usage: /${COMMAND_TRIGGER} ${renderSubcommand(trigger)}`;
}

/** the ephemeral reply to a bare or unrecognised `/collegium`: one line per subcommand, with its purpose */
export function renderCommandListing(): string {
  return [
    `Usage: /${COMMAND_TRIGGER} {subcommand}`,
    ...COMMAND_TRIGGERS.map((trigger) => `- ${renderSubcommand(trigger)} — ${COMMAND_DEFINITIONS[trigger].purpose}`)
  ].join('\n');
}
