import { Injectable } from '@nestjs/common';
import { chunk } from 'es-toolkit';

import { ActivationService } from '@/activation/activation.service.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { BackfillService } from '@/conversations/backfill/backfill.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { StatusPostService } from '@/turns/status/status-post.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { AbandonedStatusPost } from '@/turns/turns.types.ts';

import { LivenessService } from '../liveness/liveness.service.ts';

import type { BootReport } from '../runtime.types.ts';

/** a crash loop can leave hundreds of turns running, and boot must not spend hundreds of chat edits on them */
const ABANDONED_CLOSE_LIMIT = 50;

const ABANDONED_CLOSE_CONCURRENCY = 8;

/**
 * §7.3 — nothing resumes, and the order is load-bearing: grants were already verified when the
 * registries constructed, turns are abandoned before approvals are invalidated, both before
 * backfill imports the downtime, and the roster reconciles before anything can consult it. The
 * queue sweep runs last, once the world is current and the unacted turns' posts are back in the
 * queue it walks, and is the same sweep /resume performs after a halt.
 */
@Injectable()
export class BootService {
  constructor(
    private readonly activationService: ActivationService,
    private readonly backfillService: BackfillService,
    private readonly livenessService: LivenessService,
    private readonly loggingService: LoggingService,
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly rosterService: RosterService,
    private readonly statusPostService: StatusPostService,
    private readonly turnsService: TurnsService
  ) {}

  async run(): Promise<BootReport> {
    // the last life's record is read before the stamp that overwrites it
    const downtime = await this.livenessService.readDowntime();
    await this.livenessService.startStamping();
    const abandoned = await this.turnsService.abandonRunning();
    await this.closeAbandonedStatusPosts(abandoned.statusPosts);
    const requeuedTurns = await this.activationService.requeueUnacted(abandoned.unacted);
    await this.pendingDecisionsService.invalidateAll('restart');
    await this.backfillService.run();
    const reconciled = await this.rosterService.reconcile();
    if (!reconciled.success) {
      throw new Error(`failed to reconcile channel membership: ${reconciled.error.message}`);
    }
    void this.activationService.sweep();
    return { abandonedTurns: abandoned.count, downtime, requeuedTurns };
  }

  private async closeAbandonedStatusPosts(posts: readonly AbandonedStatusPost[]): Promise<void> {
    const closing = posts.slice(0, ABANDONED_CLOSE_LIMIT);
    if (posts.length > closing.length) {
      this.loggingService.warn(
        `left ${posts.length - closing.length} older abandoned status post(s) as they were: more than boot will edit`
      );
    }
    for (const batch of chunk(closing, ABANDONED_CLOSE_CONCURRENCY)) {
      await Promise.all(batch.map((post) => this.statusPostService.closeAbandoned(post)));
    }
  }
}
