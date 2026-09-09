import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { COMMANDS_PATH } from './commands.definitions.ts';
import { $CommandRequestBody } from './commands.schemas.ts';
import { CommandsService } from './commands.service.ts';

@Controller()
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @HttpCode(200)
  @Post(COMMANDS_PATH)
  async handle(@Body() body: unknown): Promise<{ response_type: string; text: string }> {
    const command = $CommandRequestBody.parse(body);
    const response = await this.commandsService.execute({
      channelId: command.channel_id,
      text: command.text,
      username: command.user_name
    });
    return { response_type: response.responseType, text: response.text };
  }
}
