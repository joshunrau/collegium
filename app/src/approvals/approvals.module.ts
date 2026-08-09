import { Module } from '@nestjs/common';

import { ChatModule } from '@/chat/chat.module.ts';

import { ApprovalsService } from './approvals.service.ts';
import { DecisionsController } from './decisions/decisions.controller.ts';
import { PendingRegistry } from './decisions/pending.registry.ts';

@Module({
  controllers: [DecisionsController],
  exports: [ApprovalsService],
  imports: [ChatModule],
  providers: [ApprovalsService, PendingRegistry]
})
export class ApprovalsModule {}
