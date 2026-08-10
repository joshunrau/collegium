import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';

import { BackfillService } from './backfill/backfill.service.ts';
import { ConversationsService } from './conversations.service.ts';
import { EpisodesService } from './episodes/episodes.service.ts';
import { ResyncService } from './resync/resync.service.ts';
import { WindowService } from './window/window.service.ts';

@Module({
  exports: [BackfillService, ConversationsService, EpisodesService, ResyncService, WindowService],
  imports: [AgentsModule, ChatModule],
  providers: [BackfillService, ConversationsService, EpisodesService, ResyncService, WindowService]
})
export class ConversationsModule {}
