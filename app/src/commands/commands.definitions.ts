type CommandDefinition = {
  /** argument shape after the trigger — drives the autocomplete hint and usage refusals; '' when none */
  readonly hint: string;
  /** one line for Mattermost's description and autocomplete fields */
  readonly purpose: string;
};

/** every trigger is namespaced, so `/coll` autocompletes the whole surface and no generic word is claimed */
const COMMAND_NAMESPACE = 'collegium';

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

/** the one path every slash command posts to; registration composes APP_PUBLIC_URL with this */
export const COMMANDS_PATH = '/commands';

/** the trigger word Mattermost holds, e.g. `collegium.stop` */
export function renderCommandTrigger(trigger: CommandTrigger): string {
  return `${COMMAND_NAMESPACE}.${trigger}`;
}

/** what Mattermost posts in `command`, e.g. `/collegium.stop` */
export function renderCommandName(trigger: CommandTrigger): string {
  return `/${renderCommandTrigger(trigger)}`;
}

export function renderUsage(trigger: CommandTrigger): string {
  return `Usage: ${renderCommandName(trigger)} ${COMMAND_DEFINITIONS[trigger].hint}`.trim();
}
