import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service.ts';
import { EnvService } from './env/env.service.ts';

@Global()
@Module({
  exports: [ConfigService, EnvService],
  providers: [ConfigService, EnvService]
})
export class ConfigModule {}
