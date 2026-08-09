import { Module } from '@nestjs/common';

import { InferenceRegistry } from './inference.registry.ts';

@Module({
  exports: [InferenceRegistry],
  providers: [InferenceRegistry]
})
export class InferenceModule {}
