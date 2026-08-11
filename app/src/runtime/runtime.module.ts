import { Module } from '@nestjs/common';

import { ActivationModule } from '@/activation/activation.module.ts';
import { AgentsModule } from '@/agents/agents.module.ts';
import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { ChannelsModule } from '@/channels/channels.module.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { CommandsModule } from '@/commands/commands.module.ts';
import { ConversationsModule } from '@/conversations/conversations.module.ts';
import { CredentialsModule } from '@/credentials/credentials.module.ts';
import { HaltModule } from '@/halt/halt.module.ts';
import { MailModule } from '@/mail/mail.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { ShellModule } from '@/shell/shell.module.ts';
import { SkillsModule } from '@/skills/skills.module.ts';
import { ToolsModule } from '@/tools/tools.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { BootService } from './boot/boot.service.ts';
import { CrashHandler } from './handlers/crash.handler.ts';
import { RuntimeService } from './runtime.service.ts';

@Module({
  imports: [
    ActivationModule,
    AgentsModule,
    ApprovalsModule,
    ChannelsModule,
    ChatModule,
    CommandsModule,
    ConversationsModule,
    CredentialsModule,
    HaltModule,
    MailModule,
    NotificationsModule,
    ShellModule,
    SkillsModule,
    ToolsModule,
    TriggersModule,
    TurnsModule
  ],
  providers: [BootService, CrashHandler, RuntimeService]
})
export class RuntimeModule {}
