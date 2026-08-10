import { Module } from '@nestjs/common';

import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { HaltService } from './halt.service.ts';

@Module({
  exports: [HaltService],
  imports: [ApprovalsModule, ChannelsModule, NotificationsModule, TurnsModule],
  providers: [HaltService]
})
export class HaltModule {}
