import { Module } from '@nestjs/common';

import { ActivationModule } from '@/activation/activation.module.ts';
import { AgentsModule } from '@/agents/agents.module.ts';
import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { HaltModule } from '@/halt/halt.module.ts';
import { MemoryModule } from '@/memory/memory.module.ts';
import { QueueModule } from '@/queue/queue.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { CommandsController } from './commands.controller.ts';
import { CommandRegistry } from './commands.registry.ts';
import { CommandsService } from './commands.service.ts';
import { ForgetHandler } from './handlers/forget.handler.ts';
import { KillHandler } from './handlers/kill.handler.ts';
import { MemoryHandler } from './handlers/memory.handler.ts';
import { PromptHandler } from './handlers/prompt.handler.ts';
import { QueueHandler } from './handlers/queue.handler.ts';
import { ResetHandler } from './handlers/reset.handler.ts';
import { ResumeHandler } from './handlers/resume.handler.ts';
import { StopHandler } from './handlers/stop.handler.ts';
import { TraceHandler } from './handlers/trace.handler.ts';
import { TriggersHandler } from './handlers/triggers.handler.ts';
import { CommandReconcilerService } from './registration/command-reconciler.service.ts';

import type { CommandHandler } from './commands.handler.ts';

/** the module's one list of handler classes — the registry's boot check makes omissions loud */
const COMMAND_HANDLER_CLASSES = [
  ForgetHandler,
  KillHandler,
  MemoryHandler,
  PromptHandler,
  QueueHandler,
  ResetHandler,
  ResumeHandler,
  StopHandler,
  TraceHandler,
  TriggersHandler
] as const;

@Module({
  controllers: [CommandsController],
  exports: [CommandReconcilerService],
  imports: [
    ActivationModule,
    AgentsModule,
    ApprovalsModule,
    ChannelsModule,
    ChatModule,
    ConversationsModule,
    HaltModule,
    MemoryModule,
    QueueModule,
    TriggersModule,
    TurnsModule
  ],
  providers: [
    ...COMMAND_HANDLER_CLASSES,
    CommandReconcilerService,
    CommandsService,
    {
      inject: [...COMMAND_HANDLER_CLASSES],
      provide: CommandRegistry,
      useFactory: (...handlers: CommandHandler[]) => new CommandRegistry(handlers)
    }
  ]
})
export class CommandsModule {}
