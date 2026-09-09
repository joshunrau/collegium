import { removeTrailingSlash } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { COMMAND_TRIGGER, COMMANDS_PATH, describeCommandSurface } from '../commands.definitions.ts';

/**
 * §8.4 — the framework declares its own command surface at boot, to the Mattermost plugin that
 * holds `/collegium` for the team. Every failure here throws and boot refuses: a framework that
 * starts without its stop switch is worse than one that does not start. Runs before any agent
 * transport connects, so /collegium stop is registered before any turn can start.
 */
@Injectable()
export class CommandReconcilerService {
  private readonly callbackUrl: string;

  constructor(
    private readonly chatGateway: ChatGateway,
    envService: EnvService,
    private readonly loggingService: LoggingService
  ) {
    this.callbackUrl = `${removeTrailingSlash(envService.get('APP_PUBLIC_URL'))}${COMMANDS_PATH}`;
  }

  async reconcile(): Promise<void> {
    const commands = describeCommandSurface();
    await this.chatGateway.declareCommandSurface({ callbackUrl: this.callbackUrl, commands });
    // a release before the plugin registered one dotted command per subcommand under this account
    const relics = await this.chatGateway.deleteOwnedSlashCommands();
    const removed = relics > 0 ? `, removed ${relics} relic slash command(s)` : '';
    this.loggingService.log(`declared /${COMMAND_TRIGGER} with ${commands.length} subcommands${removed}`);
  }
}
