import { Module } from '@nestjs/common';

import { ProcessRunner } from './runners/process.runner.ts';
import { ShellService } from './shell.service.ts';

@Module({
  exports: [ShellService],
  providers: [ProcessRunner, ShellService]
})
export class ShellModule {}
