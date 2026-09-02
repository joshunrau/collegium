import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';

import { COMMAND_TRIGGER, COMMANDS_PATH } from './commands.definitions.ts';
import { $MattermostCommandBody } from './commands.schemas.ts';
import { CommandsService } from './commands.service.ts';

@Controller()
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @HttpCode(200)
  @Post(COMMANDS_PATH)
  async handle(@Body() body: unknown): Promise<{ response_type: string; text: string }> {
    const command = $MattermostCommandBody.parse(body);
    if (command.command !== `/${COMMAND_TRIGGER}`) {
      throw new BadRequestException(`unknown command "${command.command}"`);
    }
    const response = await this.commandsService.dispatch({
      channelId: command.channel_id,
      text: command.text,
      username: command.user_name
    });
    return { response_type: response.responseType, text: response.text };
  }
}
