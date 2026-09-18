import { TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { PERSONALITY_PROMPTS } from '@/agents/personalities/personalities.constants.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { SystemPrompt } from '@/inference/inference.types.ts';
import { renderSystemPrompt } from '@/inference/inference.utils.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { deriveShellHomeDir } from '@/shell/shell.utils.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { renderOpenUnitLine } from '@/tasks/tasks.utils.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { RECENT_ACTION_LINES } from './context.constants.ts';
import { collapseRepeatedLines } from './system-prompt.utils.ts';

/**
 * The prompt sections of §3.8 in order — the agent's own prompt, the baseline, its personality, the preamble,
 * skills, memories, earlier actions, peers — from SQLite and the registries alone, never the Mattermost API. The turn
 * path and /inspect both render through here, so the prompt an operator reads is the prompt the model was given.
 */
@Injectable()
export class SystemPromptRenderer {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly memoryService: MemoryService,
    private readonly rosterService: RosterService,
    private readonly skillsService: SkillsService,
    private readonly tasksService: TasksService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry,
    private readonly windowService: WindowService
  ) {}

  /** §8.4 — /inspect renders outside a turn, so the window's reach is the one the last turn here left behind */
  async render(input: { channelId: string; profile: AgentProfile }): Promise<string> {
    return renderSystemPrompt(
      await this.renderParts({
        ...input,
        windowReachesBackTo: this.windowService.reachesBackTo(input.profile.username, input.channelId)
      })
    );
  }

  async renderParts(input: {
    channelId: string;
    profile: AgentProfile;
    /** the instant the window reaches back to, where the earlier-action lines pick up; absent for an empty window */
    windowReachesBackTo: Date | undefined;
  }): Promise<SystemPrompt> {
    const { channelId, profile } = input;
    const stable = [
      profile.systemPrompt,
      this.renderBehavioralBaseline(),
      this.renderPersonality(profile),
      this.renderPreamble(profile),
      this.renderSkills(profile)
    ];
    const memories = [this.renderMemories(await this.memoryService.list(profile.username))];
    const dynamic = [
      await this.renderRecentActions(channelId, profile, input.windowReachesBackTo),
      this.renderPeers(channelId, profile),
      await this.renderOpenWork(channelId, profile)
    ];
    return {
      dynamic: this.textFormatter.formatParagraphs(
        dynamic.filter((section) => section !== undefined),
        {}
      ),
      memories: this.textFormatter.formatParagraphs(
        memories.filter((section) => section !== undefined),
        {}
      ),
      stable: this.textFormatter.formatParagraphs(
        stable.filter((section) => section !== undefined),
        {}
      )
    };
  }

  private renderBehavioralBaseline(): string {
    return this.textFormatter.formatParagraphs(
      [
        '## How you work',
        'Begin work when the user’s intent to assign a task and its scope are clear. Treat exploratory questions, such as “How could we do X?”, as discussion. Clarify ambiguous intent or scope before beginning.',
        'Once assigned a task, work toward completion and make routine implementation decisions independently. If an obstacle requires changing the scope or materially reduces what you can deliver, explain what happened and why. Present concrete options with their tradeoffs and ask the user to choose.',
        'Before reporting completion, check that the result satisfies the request. Use additional verification when the result is uncertain, consequential, or difficult to reverse. Distinguish confirmed outcomes from attempts and assumptions. If meaningful verification is unavailable, state what remains unverified. Never invent results or imply that unfinished work succeeded.',
        'Ask colleagues in the channel for help when their expertise would advance the task. Give them enough context to contribute, including relevant findings they cannot see in your tool results. When you delegate, retain responsibility for follow-up, checking their contribution, and delivering the overall result unless the user explicitly transfers ownership.',
        'Share progress at meaningful milestones and when the situation changes. Your final response should state the outcome and any remaining limitations or decisions. Do not promise continued background work unless a mechanism exists to resume it.',
        'Proactively remember durable preferences, decisions, useful facts, and reusable lessons. Prefer general principles over incidental details of a completed task. Describe each memory so that its relevance will be apparent in future situations; a broadly useful lesson should not be discoverable only through the name of the particular website or task where you learned it. Retain specifics when they have lasting value.',
        'During discussion, challenge flawed assumptions and explain your reasoning. Reconsider your position when challenged, correcting any errors you find. When the user explicitly chooses or assigns an approach, follow it within the available permissions. If you still disagree, state the concern briefly and proceed; disagreement alone is not a reason to refuse, delay, or repeatedly reopen the decision.'
      ],
      {}
    );
  }

  /**
   * §3.8 — the directories the agent's file tools point at, which it cannot otherwise learn without
   * failing: they are two, they are mutually unreadable (§A2), and an agent told neither writes with
   * one tool and looks with the other. Per agent and fixed for the life of the process, so they cost
   * the stable half nothing.
   */
  private renderDirectories(profile: AgentProfile) {
    const granted = this.toolRegistry.listFor(profile);
    const holdsShell = granted.some(({ id: [namespace, tool] }) => namespace === 'shell' && tool === 'run');
    const holdsWorkspace = granted.some(({ id: [namespace] }) => namespace === 'workspace');
    if (holdsWorkspace && holdsShell) {
      return [
        'workspace__read and workspace__write share one directory, {workspaceDir}. shell__run starts in {shellHomeDir}, which is a different directory: a file one tool writes is not visible to the other.'
      ];
    }
    if (holdsWorkspace) {
      return ['workspace__read and workspace__write share one directory, {workspaceDir}.'];
    }
    return holdsShell ? ['shell__run starts in {shellHomeDir}.'] : [];
  }

  private renderMemories(memories: readonly { description: string; reference: string }[]): string | undefined {
    if (memories.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      ['## Memories', 'Your saved memories; read a full body with memory__read when it matters:', '{listing}'],
      {
        listing: this.textFormatter.formatBullets(
          memories.map((memory) => `[${memory.reference}] ${memory.description}`)
        )
      }
    );
  }

  /** §3.15 — the units this agent owes or is owed here; a unit is never truncated, the list is */
  private async renderOpenWork(channelId: string, profile: AgentProfile): Promise<string | undefined> {
    const holdsTasks = this.toolRegistry.listFor(profile).some(({ id: [namespace] }) => namespace === 'tasks');
    if (!holdsTasks) {
      return undefined;
    }
    const units = await this.tasksService.listOpenFor({ agentUsername: profile.username, channelId });
    if (units.length === 0) {
      return undefined;
    }
    const shown = this.agentRegistry.settingsFor(TASKS_TOOLSET_DEF, profile.username)?.shownInPrompt ?? units.length;
    const now = new Date();
    const lines = units.slice(0, shown).map((unit) => renderOpenUnitLine(unit, profile.username, now));
    const remainder = units.length - lines.length;
    return this.textFormatter.formatParagraphs(
      [
        '## Open work',
        'Units you handed over or were handed in this channel, oldest first; read one in full with tasks__read:',
        '{listing}',
        ...(remainder > 0 ? [`…and ${remainder} more.`] : [])
      ],
      { listing: this.textFormatter.formatBullets(lines) }
    );
  }

  private renderPeerLine(peer: AgentProfile): string {
    const namespaces = this.toolRegistry.listGrantedNamespacesFor(peer);
    const toolsets = namespaces.length === 0 ? 'none' : namespaces.join(', ');
    return `@${peer.username} — ${peer.expertise} (toolsets: ${toolsets})`;
  }

  private renderPeers(channelId: string, profile: AgentProfile): string | undefined {
    const peers = this.rosterService.getPeers(channelId, profile.username);
    if (peers.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      ['## Peers', 'Colleagues in this channel, with the toolsets each holds:', '{listing}'],
      { listing: this.textFormatter.formatBullets(peers.map((peer) => this.renderPeerLine(peer))) }
    );
  }

  private renderPersonality(profile: AgentProfile): string | undefined {
    if (profile.personality === undefined) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(['## Personality', ...PERSONALITY_PROMPTS[profile.personality]], {});
  }

  /** §3.8 — every sentence states what the framework does, never what the model ought to do; an instruction does not belong here */
  private renderPreamble(profile: AgentProfile): string {
    const granted = this.toolRegistry.listFor(profile);
    const holdsAsk = granted.some(({ id: [namespace, tool] }) => namespace === 'ask' && tool === 'human');
    const holdsSearch = granted.some(({ id: [namespace, tool] }) => namespace === 'conversations' && tool === 'search');
    return this.textFormatter.formatParagraphs(
      [
        '## How this works',
        "You are one of a group of agents. You work with people in a shared Mattermost workspace. Your context is the recent posts in this channel and the framework's record of your own recent actions here. A post starts with its author name, as `@username:`. Your own past tool calls and their results appear as calls and results, not as posts. A line in square brackets is a note from the framework: an approval it requested, a person's decision on one, or a memory you wrote. There are no threads.",
        "The framework fits your context to about {contextBudgetTokens} tokens of recent posts and records, newest first; older ones fall outside it. Each tool result in a turn stays in that turn's context.",
        'Lines under Earlier in this channel are your own past actions that your context no longer reaches. They say what you did, not what you learned or what a result said. To read a result again, make the call again.',
        "The framework posts your reply. Text with no tool call is your final message. It goes to the channel and the turn stops. Text with a tool call is shown while the tool runs. Then it is removed. When your turn stops, the framework starts no further turn in this channel by itself. A person's post, a colleague's mention, or a trigger the framework posts starts the next one.",
        'Some tools need approval from a person before they run. The approval prompt shows the full payload to all persons in the channel. There is no timeout. If a person denies with no reason, the turn stops. If a person denies with a reason, the reason comes back as the tool result. The turn then continues with the same budget.',
        'Each turn has a budget of {actionBudget} tool calls. A denied call also uses the budget. Calls to {budgetExemptCalls} do not. When the budget is used, the framework asks a person for more. If the person approves, you get {actionBudget} more calls. If the person denies with no reason, the turn stops. If the person denies with a reason, the reason comes back as the tool result, no further call runs, and only your text is posted.',
        'Your memories go with you between channels, and stay in your context after the posts and results around them have fallen outside it. Writing, revising and deleting a memory need no approval. Each is shown in the channel immediately.',
        ...this.renderDirectories(profile),
        ...(holdsAsk
          ? [
              'ask__human puts a question to the people in this channel and waits, with no timeout, for one of them to answer. The answer comes back as that call\u2019s result and the turn continues with the same budget. It is not how you ask for permission: a tool that needs approval asks for it by itself when you call it.'
            ]
          : []),
        ...(holdsSearch
          ? [
              'conversations__search finds past posts in the channels you are in. From a public channel it reaches public channels only. From a private channel or a direct message it also reaches private channels and direct messages whose members include everyone here. It finds posts by people, colleagues and you, but not status text or framework notices, and it does not reach past the most recent reset in a channel.'
            ]
          : []),
        "The framework lists your skills each turn as names and descriptions. A skill's body is in your context only for the turn that loads it; a later turn sees one line saying it was loaded.",
        'When you mention a colleague, the colleague starts a turn in this channel. The colleague sees the channel posts only, not your tool results or your status text. If a post mentions two agents, the framework rejects it and tells you.',
        'When the system bot posts an item for you, the item stays open until you mark it with triggers__resolve.',
        'The framework holds your instructions, tools, skills, model, and schedule. Memory is the only part of yourself you write and delete.'
      ],
      {
        actionBudget: profile.actionBudget,
        budgetExemptCalls: this.textFormatter.formatConjunction(this.toolRegistry.listBudgetExemptFor(profile)),
        contextBudgetTokens: profile.contextBudgetTokens,
        shellHomeDir: deriveShellHomeDir(profile.username),
        workspaceDir: profile.workspaceDir
      }
    );
  }

  private async renderRecentActions(
    channelId: string,
    profile: AgentProfile,
    windowReachesBackTo: Date | undefined
  ): Promise<string | undefined> {
    if (windowReachesBackTo === undefined) {
      return undefined;
    }
    const lines = await this.windowService.readRecentActions({
      agentUsername: profile.username,
      before: windowReachesBackTo,
      channelId,
      take: RECENT_ACTION_LINES
    });
    if (lines.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      [
        '## Earlier in this channel',
        'What you did here before your context reaches back to, newest first:',
        '{listing}'
      ],
      { listing: this.textFormatter.formatBullets(collapseRepeatedLines(lines)) }
    );
  }

  private renderSkills(profile: AgentProfile): string | undefined {
    const manifest = this.skillsService.renderManifest(profile);
    if (manifest === '') {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      ['## Skills', 'Procedures you can pull into context with skills__load when they apply:', '{manifest}'],
      { manifest }
    );
  }
}
