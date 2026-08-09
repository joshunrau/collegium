import { removeTrailingSlash } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { SlashCommandRegistration } from '@/chat/chat.types.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { COMMAND_DEFINITIONS, COMMAND_TRIGGERS, COMMANDS_PATH } from '../commands.definitions.ts';
import { planSlashCommandReconciliation } from './command-reconciler.utils.ts';

/**
 * §8.4 — the framework registers its own command surface at boot. Every failure here throws and
 * boot refuses: a framework that starts without its stop switch is worse than one that does not
 * start. Runs before any agent transport connects, so /stop is registered before any turn can start.
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
    this.loggingService.log(this.summarize(plan.creates.length, plan.corrections.length, plan.deletes.length));
  }

  private desiredRegistrations(): SlashCommandRegistration[] {
    return COMMAND_TRIGGERS.map((trigger) => ({
      autoCompleteHint: COMMAND_DEFINITIONS[trigger].hint,
      description: COMMAND_DEFINITIONS[trigger].purpose,
      displayName: trigger,
      trigger,
      url: this.callbackUrl
    }));
  }

  private summarize(created: number, corrected: number, removed: number): string {
    if (created === 0 && corrected === 0 && removed === 0) {
      return `reconciled ${COMMAND_TRIGGERS.length} slash commands: all current`;
    }
    return `reconciled ${COMMAND_TRIGGERS.length} slash commands: ${created} created, ${corrected} corrected, ${removed} removed`;
  }
}
