import { Module } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatModule } from '@/chat/chat.module.ts';
import { ConfigService } from '@/config/config.service.ts';
import { TriggersModule } from '@/triggers/triggers.module.ts';

import { SchedulesRegistry } from './schedules.registry.ts';
import { SchedulesService } from './schedules.service.ts';

@Module({
  exports: [SchedulesRegistry, SchedulesService],
  imports: [ChatModule, TriggersModule],
  providers: [
    SchedulesService,
    {
      inject: [ChatGateway, ConfigService],
      provide: SchedulesRegistry,
      useFactory: (chatGateway: ChatGateway, configService: ConfigService) => {
        return SchedulesRegistry.resolve(chatGateway, {
          agents: Object.values(configService.get('agents')),
          defaultTimezone: configService.get('display.timezone')
        });
      }
    }
  ]
})
export class SchedulesModule {}
