import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';

import { MailBootService } from './boot/boot.service.ts';
import { MailInboundService } from './inbound/inbound.service.ts';
import { MailRegistry } from './mail.registry.ts';
import { MAIL_REGISTRY_TOKEN } from './mail.tokens.ts';
import { MAIL_TOOLSET } from './mail.toolset.ts';
import { MailOutageService } from './outage/outage.service.ts';

@Module({
  exports: [MailBootService, MailInboundService, MailRegistry, MAIL_REGISTRY_TOKEN],
  imports: [AgentsModule, ChannelsModule, ChatModule, TriggersModule],
  providers: [
    MailBootService,
    MailInboundService,
    MailOutageService,
    {
      inject: [AgentRegistry, ChatGateway],
      provide: MailRegistry,
      useFactory: (agentRegistry: AgentRegistry, chatGateway: ChatGateway) => {
        const mailboxes = agentRegistry.list().flatMap((profile) => {
          const settings = agentRegistry.settingsFor(MAIL_TOOLSET, profile.username);
          return settings === undefined ? [] : [{ agentUsername: profile.username, settings }];
        });
        return MailRegistry.resolve(chatGateway, mailboxes);
      }
    },
    { provide: MAIL_REGISTRY_TOKEN, useExisting: MailRegistry }
  ]
})
export class MailModule {}
