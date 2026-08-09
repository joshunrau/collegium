import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { HaltModule } from '@/halt/halt.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { QueueModule } from '@/queue/queue.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { ActivationService } from './activation.service.ts';
import { DebounceService } from './debounce/debounce.service.ts';

/**
 * Dependency direction: `activation` → `turns` → everything else. This is the only module that
 * both starts turns and reacts to their completion, which is what keeps the graph acyclic: when a
 * turn ends, `activation` — not `turns` — drains the queue and flushes pending triggers. Nothing
 * may depend on `activation` except the runtime wiring layer and the `/resume` handler's sweep.
 */
@Module({
  exports: [ActivationService],
  imports: [
    AgentsModule,
    ChannelsModule,
    ChatModule,
    ConversationsModule,
    HaltModule,
    NotificationsModule,
    QueueModule,
    TriggersModule,
    TurnsModule
  ],
  providers: [ActivationService, DebounceService]
})
export class ActivationModule {}
