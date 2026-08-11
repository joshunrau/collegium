import { Module } from '@nestjs/common';

import { EnvService } from '@/config/env/env.service.ts';
import { CredentialsModule } from '@/credentials/credentials.module.ts';

import { MattermostAdminClient } from './adapters/mattermost-admin.client.ts';
import { ProvisioningService } from './provisioning.service.ts';

@Module({
  exports: [ProvisioningService],
  imports: [CredentialsModule],
  providers: [
    ProvisioningService,
    {
      inject: [EnvService],
      provide: MattermostAdminClient,
      useFactory: (envService: EnvService) => new MattermostAdminClient({ url: envService.get('MATTERMOST_URL') })
    }
  ]
})
export class ProvisioningModule {}
