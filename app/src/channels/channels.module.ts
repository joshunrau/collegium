import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';

import { ChannelsService } from './channels.service.ts';
import { ChannelLockService } from './locks/channel-lock.service.ts';
import { MultiMentionPolicy } from './refusals/multi-mention.policy.ts';
import { RosterService } from './roster/roster.service.ts';

@Module({
  exports: [ChannelLockService, ChannelsService, MultiMentionPolicy, RosterService],
  imports: [AgentsModule, ChatModule],
  providers: [ChannelLockService, ChannelsService, MultiMentionPolicy, RosterService]
})
export class ChannelsModule {}
