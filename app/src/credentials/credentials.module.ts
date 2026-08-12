import { Module } from '@nestjs/common';

import { CredentialsService } from './credentials.service.ts';

@Module({
  exports: [CredentialsService],
  providers: [CredentialsService]
})
export class CredentialsModule {}
