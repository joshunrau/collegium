import { Module } from '@nestjs/common';

import { MattermostGateway } from './adapters/mattermost.gateway.ts';
import { ChatGateway } from './chat.gateway.ts';
import { TransportRegistry } from './transports/transport.registry.ts';

@Module({
  exports: [ChatGateway, TransportRegistry],
  providers: [
    {
      provide: ChatGateway,
      useClass: MattermostGateway
    },
    TransportRegistry
  ]
})
export class ChatModule {}
