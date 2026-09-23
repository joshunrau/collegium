import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';

import { BackfillService } from './backfill/backfill.service.ts';
import { ConversationsService } from './conversations.service.ts';
import { SEARCH_SERVICE_TOKEN } from './conversations.tokens.ts';
import { EpisodesService } from './episodes/episodes.service.ts';
import { PinsService } from './pins/pins.service.ts';
import { ResyncService } from './resync/resync.service.ts';
import { SearchService } from './search/search.service.ts';
import { WindowService } from './window/window.service.ts';

@Module({
  exports: [
    BackfillService,
    ConversationsService,
    EpisodesService,
    PinsService,
    ResyncService,
    SEARCH_SERVICE_TOKEN,
    SearchService,
    WindowService
  ],
  imports: [AgentsModule, ChatModule],
  providers: [
    BackfillService,
    ConversationsService,
    EpisodesService,
    PinsService,
    ResyncService,
    SearchService,
    { provide: SEARCH_SERVICE_TOKEN, useExisting: SearchService },
    WindowService
  ]
})
export class ConversationsModule {}
