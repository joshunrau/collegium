import { Module } from '@nestjs/common';

import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { MemoryModule } from '@/memory/memory.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { QueueModule } from '@/queue/queue.module.ts';
import { TasksModule } from '@/tasks/tasks.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { ClearingService } from './clearing.service.ts';
import { ConfirmationController } from './confirmation/confirmation.controller.ts';
import { ChannelErasure } from './erasure/channel-erasure.service.ts';

@Module({
  controllers: [ConfirmationController],
  exports: [ClearingService],
  imports: [
    ApprovalsModule,
    ChannelsModule,
    ChatModule,
    ConversationsModule,
    MemoryModule,
    NotificationsModule,
    QueueModule,
    TasksModule,
    TriggersModule,
    TurnsModule
  ],
  providers: [ChannelErasure, ClearingService]
})
export class ClearingModule {}
