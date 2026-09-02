import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';

import { COMMANDS_PATH } from './commands.definitions.ts';
import { CommandRegistry } from './commands.registry.ts';
import { $MattermostCommandBody } from './commands.schemas.ts';
import { CommandsService } from './commands.service.ts';

@Controller()
export class CommandsController {
  constructor(
    private readonly commandRegistry: CommandRegistry,
    private readonly commandsService: CommandsService
  ) {}

  @HttpCode(200)
  @Post(COMMANDS_PATH)
  async handle(@Body() body: unknown): Promise<{ response_type: string; text: string }> {
    const command = $MattermostCommandBody.parse(body);
    const handler = this.commandRegistry.resolve(command.command);
    if (!handler) {
      throw new BadRequestException(`unknown command "${command.command}"`);
    }
    const response = await this.commandsService.run(handler, {
      channelId: command.channel_id,
      text: command.text,
      username: command.user_name
    });
    return { response_type: response.responseType, text: response.text };
  }
}
