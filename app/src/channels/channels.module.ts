import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConfigService } from '@/config/config.service.ts';

import { ChannelsService } from './channels.service.ts';
import { ChannelLockService } from './locks/channel-lock.service.ts';
import { MultiMentionPolicy } from './refusals/multi-mention.policy.ts';
import { RosterService } from './roster/roster.service.ts';

@Module({
  exports: [ChannelLockService, ChannelsService, MultiMentionPolicy, RosterService],
  imports: [AgentsModule, ChatModule],
  providers: [
    ChannelLockService,
    {
      inject: [ChatGateway, ConfigService],
      provide: ChannelsService,
      useFactory: async (chatGateway: ChatGateway, configService: ConfigService) => {
        const modes = await Promise.all(
          configService.get('channels').map(async (channel) => {
            return [await chatGateway.resolveChannelId(channel.handle), channel.triggerMode] as const;
          })
        );
        return new ChannelsService(new Map(modes));
      }
    },
    MultiMentionPolicy,
    RosterService
  ]
})
export class ChannelsModule {}
