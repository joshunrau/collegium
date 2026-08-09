import type { CommandTrigger } from './commands.definitions.ts';
import type { CommandInput, CommandResponse } from './commands.types.ts';

/** one slash command's behavior, named by the trigger it answers — what the registry assembles */
export abstract class CommandHandler {
  abstract readonly trigger: CommandTrigger;

  abstract handle(input: CommandInput): Promise<CommandResponse>;
}
