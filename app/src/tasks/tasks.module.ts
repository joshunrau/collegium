import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';

import { CounterpartStateService } from './counterparts/counterpart-state.service.ts';
import { PostSightingsRegistry } from './sightings/post-sightings.registry.ts';
import { TasksService } from './tasks.service.ts';
import { TASKS_MOMENT_FORMATTER_TOKEN, TASKS_SERVICE_TOKEN, TASKS_SIGHTINGS_TOKEN } from './tasks.tokens.ts';

@Module({
  exports: [
    PostSightingsRegistry,
    TASKS_MOMENT_FORMATTER_TOKEN,
    TASKS_SERVICE_TOKEN,
    TASKS_SIGHTINGS_TOKEN,
    TasksService
  ],
  imports: [AgentsModule, ApprovalsModule, ChannelsModule, ConversationsModule],
  providers: [
    CounterpartStateService,
    PostSightingsRegistry,
    TasksService,
    { provide: TASKS_MOMENT_FORMATTER_TOKEN, useExisting: MomentFormatter },
    { provide: TASKS_SERVICE_TOKEN, useExisting: TasksService },
    { provide: TASKS_SIGHTINGS_TOKEN, useExisting: PostSightingsRegistry }
  ]
})
export class TasksModule {}
