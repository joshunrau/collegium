import { Module } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { CredentialsModule } from '@/credentials/credentials.module.ts';
import { CredentialsService } from '@/credentials/credentials.service.ts';
import { LoggerFactory } from '@/logging/logging.factory.ts';

import { MattermostGateway } from './adapters/mattermost.gateway.ts';
import { ChatGateway } from './chat.gateway.ts';
import { TransportRegistry } from './transports/transport.registry.ts';

@Module({
  exports: [ChatGateway, TransportRegistry],
  imports: [CredentialsModule],
  providers: [
    {
      inject: [ConfigService, EnvService, LoggerFactory, CredentialsService],
      provide: ChatGateway,
      useFactory: async (
        configService: ConfigService,
        envService: EnvService,
        loggerFactory: LoggerFactory,
        credentialsService: CredentialsService
      ) => {
        const username = configService.get('mattermost.systemBotUsername');
        const systemBotToken = await credentialsService.require(username);
        return new MattermostGateway({ systemBotToken }, configService, envService, loggerFactory);
      }
    },
    TransportRegistry
  ]
})
export class ChatModule {}
