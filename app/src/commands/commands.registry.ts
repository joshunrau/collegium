import { COMMAND_TRIGGERS, renderCommandName } from './commands.definitions.ts';

import type { CommandTrigger } from './commands.definitions.ts';
import type { CommandHandler } from './commands.handler.ts';

/**
 * Assembles the trigger→handler table and refuses to boot incomplete: a command in the §8.4 list
 * with no handler, or two handlers claiming one trigger, is a wiring mistake caught here rather
 * than a 400 at the first click.
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
    this.handlers = new Map([...byTrigger].map(([trigger, handler]) => [renderCommandName(trigger), handler]));
  }

  /** accepts only the wire form Mattermost sends, e.g. "/collegium.stop" — a bare "stop" resolves nothing */
  resolve(command: string): CommandHandler | undefined {
    return this.handlers.get(command);
  }
}
