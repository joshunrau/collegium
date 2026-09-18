import { Module } from '@nestjs/common';

import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';

import { ApprovalsService } from './approvals.service.ts';
import { AsksService } from './asks.service.ts';
import { ApprovalPendingRegistry } from './decisions/approval-pending.registry.ts';
import { AskPendingRegistry } from './decisions/ask-pending.registry.ts';
import { DecisionsController } from './decisions/decisions.controller.ts';
import { PendingDecisionsService } from './decisions/pending-decisions.service.ts';

@Module({
  controllers: [DecisionsController],
  exports: [ApprovalsService, AsksService, PendingDecisionsService],
  imports: [ChannelsModule, ChatModule],
  providers: [ApprovalPendingRegistry, ApprovalsService, AskPendingRegistry, AsksService, PendingDecisionsService]
})
export class ApprovalsModule {}
