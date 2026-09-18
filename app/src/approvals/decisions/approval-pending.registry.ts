import { Injectable } from '@nestjs/common';

import { PendingRegistry } from './pending.registry.ts';

import type { ApprovalDecision } from '../approvals.types.ts';

/** the resolvers of turns parked on an approval (§3.7); a distinct class because Nest injects by token */
@Injectable()
export class ApprovalPendingRegistry extends PendingRegistry<ApprovalDecision> {}
