import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';

import { TriggersController } from './triggers.controller.ts';
import { TriggersService } from './triggers.service.ts';
import { TRIGGERS_SERVICE_TOKEN } from './triggers.tokens.ts';

@Module({
  controllers: [TriggersController],
  exports: [TriggersService, TRIGGERS_SERVICE_TOKEN],
  imports: [AgentsModule, ChannelsModule, ChatModule, ConversationsModule],
  providers: [TriggersService, { provide: TRIGGERS_SERVICE_TOKEN, useExisting: TriggersService }]
})
export class TriggersModule {}
