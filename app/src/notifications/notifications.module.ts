import { Module } from '@nestjs/common';

import { ChatModule } from '@/chat/chat.module.ts';

import { ChatEmitter } from './adapters/chat.emitter.ts';
import { NotificationsEmitter } from './notifications.emitter.ts';
import { NotificationsService } from './notifications.service.ts';

@Module({
  exports: [NotificationsService],
  imports: [ChatModule],
  providers: [
    NotificationsService,
    {
      provide: NotificationsEmitter,
      useClass: ChatEmitter
    }
  ]
})
export class NotificationsModule {}
