import { Module } from '@nestjs/common';

import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { HaltModule } from '@/halt/halt.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { QueueModule } from '@/queue/queue.module.ts';

import { StallsService } from './stalls.service.ts';

@Module({
  exports: [StallsService],
  imports: [ApprovalsModule, ChannelsModule, HaltModule, NotificationsModule, QueueModule],
  providers: [StallsService]
})
export class StallsModule {}
