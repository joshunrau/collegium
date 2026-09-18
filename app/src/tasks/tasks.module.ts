import { Module } from '@nestjs/common';

import { AgentsModule } from '@/agents/agents.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';

import { TasksService } from './tasks.service.ts';
import { TASKS_SERVICE_TOKEN } from './tasks.tokens.ts';

@Module({
  exports: [TasksService, TASKS_SERVICE_TOKEN],
  imports: [AgentsModule, ChannelsModule],
  providers: [TasksService, { provide: TASKS_SERVICE_TOKEN, useExisting: TasksService }]
})
export class TasksModule {}
