import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { renderBaselineSection } from './baseline/baseline.section.ts';
import { renderPreambleSection } from './preamble/preamble.section.ts';
import { TAIL_OPENING_LINE } from './prompt.constants.ts';
import { EarlierActionsSection } from './sections/earlier-actions.section.ts';
import { MemoriesSection } from './sections/memories.section.ts';
import { OpenWorkSection } from './sections/open-work.section.ts';
import { PeersSection } from './sections/peers.section.ts';
import { renderPersonalitySection } from './sections/personality.section.ts';
import { renderSkillsSection } from './sections/skills.section.ts';

import type { StablePromptInput, TurnPrompt, TurnPromptInput } from './prompt.types.ts';

/**
 * The prompt sections of §3.8, from SQLite and the registries alone, never the Mattermost API. The
 * turn path and /inspect both render through here, so the prompt an operator reads is the prompt
 * the model was given.
 */
@Injectable()
export class PromptRenderer {
  private readonly foldLimit: number;

  constructor(
    configService: ConfigService,
    private readonly earlierActionsSection: EarlierActionsSection,
    private readonly mailRegistry: MailRegistry,
    private readonly memoriesSection: MemoriesSection,
    private readonly openWorkSection: OpenWorkSection,
    private readonly peersSection: PeersSection,
    private readonly rosterService: RosterService,
    private readonly shellService: ShellService,
    private readonly skillsService: SkillsService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry,
    private readonly windowService: WindowService
  ) {
    this.foldLimit = configService.get('activation.foldLimit');
  }

  /** §8.4 — /inspect renders outside a turn, so the window's reach is the one the last turn here left behind */
  async render(input: { channelId: string; profile: AgentProfile }): Promise<string> {
    const { stable, tail } = await this.renderParts({
      ...input,
      windowReachesBackTo: this.windowService.reachesBackTo(input.profile.username, input.channelId)
    });
    return tail === undefined ? stable : `${stable}\n\n${tail}`;
  }

  /** §3.8 — `stable` precedes the window and `tail` follows it, so a section whose text can change between turns goes in the tail */
  async renderParts(input: TurnPromptInput): Promise<TurnPrompt> {
    const stableInput = this.readStableInput(input.profile);
    const stable = [
      input.profile.systemPrompt,
      renderBaselineSection(stableInput),
      renderPersonalitySection(stableInput),
      renderPreambleSection(stableInput),
      renderSkillsSection(stableInput)
    ].filter((section) => section !== undefined);
    const tail = [
      await this.memoriesSection.render(input),
      await this.earlierActionsSection.render(input),
      this.peersSection.render(input),
      await this.openWorkSection.render(input)
    ].filter((section) => section !== undefined);
    return {
      stable: this.textFormatter.formatParagraphs(stable, {}),
      tail: tail.length === 0 ? undefined : this.textFormatter.formatParagraphs([TAIL_OPENING_LINE, ...tail], {})
    };
  }

  private readStableInput(profile: AgentProfile): StablePromptInput {
    const mailbox = this.mailRegistry.mailboxFor(profile.username);
    return {
      budgetExemptCalls: this.toolRegistry.listBudgetExemptFor(profile),
      foldLimit: this.foldLimit,
      granted: this.toolRegistry.listFor(profile),
      mailbox: mailbox && {
        address: mailbox.provider.address,
        announcementChannelName: this.rosterService.nameOf(mailbox.announcementChannelId, profile.username)
      },
      presentCommands: this.shellService.listPresentCommands(),
      profile,
      skillsManifest: this.skillsService.renderManifest(profile),
      supersedableCalls: this.toolRegistry.listSupersedableFor(profile),
      textFormatter: this.textFormatter
    };
  }
}
