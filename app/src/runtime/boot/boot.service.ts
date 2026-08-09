import { Injectable } from '@nestjs/common';

import { ActivationService } from '@/activation/activation.service.ts';
import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { BackfillService } from '@/conversations/backfill/backfill.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { TurnsService } from '@/turns/turns.service.ts';

export type BootReport = {
  readonly abandonedTurns: number;
  readonly downSince: Date | undefined;
};

/**
 * §7.3 — nothing resumes, and the order is load-bearing: grants are verified before recovery
 * touches any state, turns are abandoned before approvals are invalidated, both before backfill
 * imports the downtime, and the roster reconciles before anything can consult it. The queue sweep
 * runs last, once the world is current, and is the same sweep /resume performs after a halt.
 */
@Injectable()
export class BootService {
  constructor(
    private readonly activationService: ActivationService,
    private readonly agentRegistry: AgentRegistry,
    private readonly approvalsService: ApprovalsService,
    private readonly backfillService: BackfillService,
    private readonly conversationsService: ConversationsService,
    private readonly rosterService: RosterService,
    private readonly skillsService: SkillsService,
    private readonly toolRegistry: ToolRegistry,
    private readonly turnsService: TurnsService
  ) {}

  async run(): Promise<BootReport> {
    this.toolRegistry.verifyGrants(this.agentRegistry.list());
    this.skillsService.verifyGrants(this.agentRegistry.list());
    const downSince = await this.conversationsService.latestObservedAt();
    const abandonedTurns = await this.turnsService.abandonRunning();
    await this.approvalsService.invalidateAll('restart');
    await this.backfillService.run();
    const reconciled = await this.rosterService.reconcile();
    if (!reconciled.success) {
      throw new Error(`failed to reconcile channel membership: ${reconciled.error.message}`);
    }
    void this.activationService.sweep();
    return { abandonedTurns, downSince };
  }
}
