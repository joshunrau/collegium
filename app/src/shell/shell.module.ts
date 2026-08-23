import { Module } from '@nestjs/common';

import { ProcessRunner } from './runners/process.runner.ts';
import { ShellService } from './shell.service.ts';
import { SHELL_SERVICE_TOKEN } from './shell.tokens.ts';

@Module({
  exports: [ShellService, SHELL_SERVICE_TOKEN],
  providers: [ProcessRunner, ShellService, { provide: SHELL_SERVICE_TOKEN, useExisting: ShellService }]
})
export class ShellModule {}
