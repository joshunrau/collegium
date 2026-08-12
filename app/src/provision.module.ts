import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module.ts';
import { LoggingModule } from './logging/logging.module.ts';
import { PrismaModule } from './prisma/prisma.module.ts';
import { ProvisioningModule } from './provisioning/provisioning.module.ts';

/**
 * The app module's counterpart for the provisioning process: the two config perimeters, the store
 * the minted tokens are kept in, and nothing else. No transports, no tools, no turns — provisioning
 * runs before any of that exists.
 */
@Module({
  imports: [ConfigModule, LoggingModule, PrismaModule.forRoot(), ProvisioningModule]
})
export class ProvisionModule {}
