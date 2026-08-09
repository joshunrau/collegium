import type { Tool } from '@collegium/core/tools';
import { Module } from '@nestjs/common';

import { ApprovalsModule } from '@/approvals/approvals.module.ts';
import { MailModule } from '@/mail/mail.module.ts';
import { MemoryModule } from '@/memory/memory.module.ts';
import { PluginsModule } from '@/plugins/plugins.module.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { ShellModule } from '@/shell/shell.module.ts';
import { SkillsModule } from '@/skills/skills.module.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';
import { WebModule } from '@/web/web.module.ts';

import { BrowserTool } from './library/browser.tool.ts';
import { LoadSkillTool } from './library/load-skill.tool.ts';
import { MailTool } from './library/mail.tool.ts';
import { ReadMemoryTool } from './library/read-memory.tool.ts';
import { ResolveTriggerTool } from './library/resolve-trigger.tool.ts';
import { ShellTool } from './library/shell.tool.ts';
import { WriteFileTool } from './library/write-file.tool.ts';
import { WriteMemoryTool } from './library/write-memory.tool.ts';
import { TOOL_NAMES } from './tools.constants.ts';
import { ToolExecutor } from './tools.executor.ts';
import { TOOL_LIBRARY_PROVIDER, ToolRegistry } from './tools.registry.ts';

type ToolClassTuple<TNames extends readonly string[]> = {
  [I in keyof TNames]: new (...args: never[]) => Tool.Any & { readonly name: TNames[I] };
};

/** positionally pinned to `TOOL_NAMES`, so a name whose implementing class is missing cannot compile */
export const TOOL_CLASSES: ToolClassTuple<typeof TOOL_NAMES> = [
  BrowserTool,
  LoadSkillTool,
  MailTool,
  ReadMemoryTool,
  ResolveTriggerTool,
  ShellTool,
  WriteFileTool,
  WriteMemoryTool
];

/** the tools' service modules are imported here, where the tools live — never forwarded by the turn */
@Module({
  exports: [ToolExecutor, ToolRegistry],
  imports: [
    ApprovalsModule,
    MailModule,
    MemoryModule,
    PluginsModule,
    ShellModule,
    SkillsModule,
    TriggersModule,
    WebModule
  ],
  providers: [
    ...TOOL_CLASSES,
    ToolExecutor,
    ToolRegistry,
    {
      inject: [PluginsRegistry, ...TOOL_CLASSES],
      provide: TOOL_LIBRARY_PROVIDER,
      useFactory: (pluginsRegistry: PluginsRegistry, ...tools: Tool.Any[]) => [...tools, ...pluginsRegistry.tools]
    }
  ]
})
export class ToolsModule {}
