import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';

import { ChatEmitter } from './adapters/chat.emitter.ts';
import { ChannelAnnouncer } from './announcing/channel-announcer.service.ts';
import { NotificationsEmitter } from './notifications.emitter.ts';
import { NotificationsService } from './notifications.service.ts';

@Module({
  exports: [ChannelAnnouncer, NotificationsService],
  imports: [AgentsModule, ChannelsModule, ChatModule],
  providers: [
    ChannelAnnouncer,
    NotificationsService,
    {
      provide: NotificationsEmitter,
      useClass: ChatEmitter
    }
  ]
})
export class NotificationsModule {}
