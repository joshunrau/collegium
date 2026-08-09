import { Module } from '@nestjs/common';

import { QueueService } from './queue.service.ts';

@Module({
  exports: [QueueService],
  providers: [QueueService]
})
export class QueueModule {}
