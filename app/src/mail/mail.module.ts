import { Module } from '@nestjs/common';

import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';

import { MailBootService } from './boot/boot.service.ts';
import { MailInboundService } from './inbound/inbound.service.ts';
import { MailRegistry } from './mail.registry.ts';

@Module({
  exports: [MailBootService, MailInboundService, MailRegistry],
  imports: [ChannelsModule, ChatModule, TriggersModule],
  providers: [MailBootService, MailInboundService, MailRegistry]
})
export class MailModule {}
