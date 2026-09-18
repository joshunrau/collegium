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
import { InferenceModule } from '@/inference/inference.module.ts';
import { MailModule } from '@/mail/mail.module.ts';
import { NotificationsModule } from '@/notifications/notifications.module.ts';
import { PluginsModule } from '@/plugins/plugins.module.ts';
import { SchedulesModule } from '@/schedules/schedules.module.ts';
import { ShellModule } from '@/shell/shell.module.ts';
import { SkillsModule } from '@/skills/skills.module.ts';
import { ToolsModule } from '@/tools/tools.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { TurnsModule } from '@/turns/turns.module.ts';

import { BootService } from './boot/boot.service.ts';
import { CrashHandler } from './handlers/crash.handler.ts';
import { LivenessService } from './liveness/liveness.service.ts';
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
    InferenceModule,
    MailModule,
    NotificationsModule,
    PluginsModule,
    SchedulesModule,
    ShellModule,
    SkillsModule,
    ToolsModule,
    TriggersModule,
    TurnsModule
  ],
  providers: [BootService, CrashHandler, LivenessService, RuntimeService]
})
export class RuntimeModule {}
