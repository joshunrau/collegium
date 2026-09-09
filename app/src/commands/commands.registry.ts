import { COMMAND_TRIGGERS, renderCommandName } from './commands.definitions.ts';
import { splitLeadingWord } from './commands.utils.ts';

import type { CommandTrigger } from './commands.definitions.ts';
import type { CommandHandler } from './commands.handler.ts';

/** the handler a forwarded execution resolves to, with the subcommand word consumed */
export type ResolvedCommand = {
  readonly handler: CommandHandler;
  readonly text: string;
};

/**
 * Assembles the subcommand→handler table and refuses to boot incomplete: a command in the §8.4 list
 * with no handler, or two handlers claiming one subcommand, is a wiring mistake caught here rather
 * than a usage refusal at the first keystroke.
 */
export class CommandRegistry {
  private readonly handlers: ReadonlyMap<string, CommandHandler>;

  constructor(handlers: readonly CommandHandler[]) {
    const byTrigger = new Map<CommandTrigger, CommandHandler>();
    for (const handler of handlers) {
      if (byTrigger.has(handler.trigger)) {
        throw new Error(`two command handlers claim ${renderCommandName(handler.trigger)}`);
      }
      byTrigger.set(handler.trigger, handler);
    }
    const missing = COMMAND_TRIGGERS.filter((trigger) => !byTrigger.has(trigger));
    if (missing.length > 0) {
      throw new Error(`no handler provided for ${missing.map(renderCommandName).join(', ')}`);
    }
    this.handlers = byTrigger;
  }

  /** the text after `/collegium` as the plugin forwards it, e.g. "memory mira prune ref-1" */
  resolve(text: string): ResolvedCommand | undefined {
    const { rest, word } = splitLeadingWord(text);
    const handler = this.handlers.get(word);
    return handler && { handler, text: rest };
  }
}
