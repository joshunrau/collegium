import { COMMAND_TRIGGERS } from './commands.definitions.ts';

import type { CommandHandler } from './commands.handler.ts';

/**
 * Assembles the trigger→handler table and refuses to boot incomplete: a command in the §8.4 list
 * with no handler, or two handlers claiming one trigger, is a wiring mistake caught here rather
 * than a 400 at the first click.
 */
export class CommandRegistry {
  private readonly handlers: ReadonlyMap<string, CommandHandler>;

  constructor(handlers: readonly CommandHandler[]) {
    const byTrigger = new Map<string, CommandHandler>();
    for (const handler of handlers) {
      if (byTrigger.has(handler.trigger)) {
        throw new Error(`two command handlers claim /${handler.trigger}`);
      }
      byTrigger.set(handler.trigger, handler);
    }
    const missing = COMMAND_TRIGGERS.filter((trigger) => !byTrigger.has(trigger));
    if (missing.length > 0) {
      throw new Error(`no handler provided for ${missing.map((trigger) => `/${trigger}`).join(', ')}`);
    }
    this.handlers = byTrigger;
  }

  resolve(trigger: string): CommandHandler | undefined {
    return this.handlers.get(trigger);
  }
}
