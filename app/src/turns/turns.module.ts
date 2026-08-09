import { Module } from '@nestjs/common';

import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { InferenceModule } from '@/inference/inference.module.ts';
import { MemoryModule } from '@/memory/memory.module.ts';
import { SkillsModule } from '@/skills/skills.module.ts';
import { ToolsModule } from '@/tools/tools.module.ts';
import { WebModule } from '@/web/web.module.ts';

import { ContextAssembler } from './context/context.assembler.ts';
import { TurnControlRegistry } from './control/turn-control.registry.ts';
import { TurnFoldRegistry } from './folding/turn-fold.registry.ts';
import { StatusPostService } from './status/status-post.service.ts';
import { TurnRunner } from './turns.runner.ts';
import { TurnsService } from './turns.service.ts';
import { TypingIndicatorService } from './typing/typing-indicator.service.ts';

@Module({
  exports: [ContextAssembler, TurnControlRegistry, TurnFoldRegistry, TurnRunner, TurnsService],
  imports: [
    ApprovalsModule,
    ChannelsModule,
    ChatModule,
    ConversationsModule,
    InferenceModule,
    MemoryModule,
    SkillsModule,
    ToolsModule,
    WebModule
  ],
  providers: [
    ContextAssembler,
    StatusPostService,
    TurnControlRegistry,
    TurnFoldRegistry,
    TurnRunner,
    TurnsService,
    TypingIndicatorService
  ]
})
export class TurnsModule {}
