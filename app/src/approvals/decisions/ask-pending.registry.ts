import { Injectable } from '@nestjs/common';

import { PendingRegistry } from './pending.registry.ts';

import type { AskDecision } from '../asks.types.ts';

/** the resolvers of turns parked on a question (§3.7a); a distinct class because Nest injects by token */
@Injectable()
export class AskPendingRegistry extends PendingRegistry<AskDecision> {}
