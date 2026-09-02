import { removeTrailingSlash } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { SlashCommandRegistration } from '@/chat/chat.types.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import {
  COMMAND_DESCRIPTION,
  COMMAND_TRIGGER,
  COMMANDS_PATH,
  renderAutocompleteHint
} from '../commands.definitions.ts';
import { planSlashCommandReconciliation } from './command-reconciler.utils.ts';

import type { SlashCommandReconciliationPlan } from './command-reconciler.utils.ts';

/**
 * §8.4 — the framework registers its own command surface at boot. Every failure here throws and
 * boot refuses: a framework that starts without its stop switch is worse than one that does not
 * start. Runs before any agent transport connects, so /collegium stop is registered before any turn can start.
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
    const surface = await this.chatGateway.snapshotSlashCommandSurface();
    const plan = planSlashCommandReconciliation({ desired: this.desiredRegistrations(), surface });
    if (plan.collisions.length > 0) {
      const named = plan.collisions
        .map((command) => `/${command.trigger} (created by @${command.creatorUsername})`)
        .join(', ');
      throw new Error(
        `slash commands held by accounts this app does not own: ${named} — an unresolvable collision (§8.4). ` +
          'If a previous system bot account created them, delete them and reboot.'
      );
    }
    for (const command of plan.deletes) {
      await this.chatGateway.deleteSlashCommand(command.id);
    }
    for (const correction of plan.corrections) {
      await this.chatGateway.correctSlashCommand(correction.commandId, correction.registration);
    }
    for (const registration of plan.creates) {
      await this.chatGateway.createSlashCommand(registration);
    }
    this.loggingService.log(this.summarize(plan));
  }

  private desiredRegistrations(): SlashCommandRegistration[] {
    return [
      {
        autoCompleteHint: renderAutocompleteHint(),
        description: COMMAND_DESCRIPTION,
        displayName: COMMAND_TRIGGER,
        trigger: COMMAND_TRIGGER,
        url: this.callbackUrl
      }
    ];
  }

  private summarize({ corrections, creates, deletes }: SlashCommandReconciliationPlan): string {
    if (creates.length === 0 && corrections.length === 0 && deletes.length === 0) {
      return `reconciled /${COMMAND_TRIGGER}: current`;
    }
    return `reconciled /${COMMAND_TRIGGER}: ${creates.length} created, ${corrections.length} corrected, ${deletes.length} removed`;
  }
}
