import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';

import { TriggersController } from './triggers.controller.ts';
import { TriggersService } from './triggers.service.ts';

@Module({
  controllers: [TriggersController],
  exports: [TriggersService],
  imports: [AgentsModule, ChannelsModule, ChatModule, ConversationsModule],
  providers: [TriggersService]
})
export class TriggersModule {}
