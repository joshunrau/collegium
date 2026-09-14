import { Module } from '@nestjs/common';

import { ResourcesService } from './resources.service.ts';

@Module({
  exports: [ResourcesService],
  providers: [ResourcesService]
})
export class ResourcesModule {}
