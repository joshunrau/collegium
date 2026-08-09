import { Global, Module } from '@nestjs/common';

import { ConsoleBridge } from './bridges/console.bridge.ts';
import { LoggerFactory } from './logging.factory.ts';
import { LoggingService } from './logging.service.ts';

@Global()
@Module({
  exports: [LoggerFactory, LoggingService],
  providers: [ConsoleBridge, LoggerFactory, LoggingService]
})
export class LoggingModule {}
