import { Module } from '@nestjs/common';

import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConfigService } from '@/config/config.service.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';

import { MailBootService } from './boot/boot.service.ts';
import { MailInboundService } from './inbound/inbound.service.ts';
import { MailRegistry } from './mail.registry.ts';
import { MailOutageService } from './outage/outage.service.ts';

@Module({
  exports: [MailBootService, MailInboundService, MailRegistry],
  imports: [ChannelsModule, ChatModule, TriggersModule],
  providers: [
    MailBootService,
    MailInboundService,
    MailOutageService,
    {
      inject: [ChatGateway, ConfigService],
      provide: MailRegistry,
      useFactory: (chatGateway: ChatGateway, configService: ConfigService) => {
        return MailRegistry.resolve(chatGateway, configService.get('agents'));
      }
    }
  ]
})
export class MailModule {}
