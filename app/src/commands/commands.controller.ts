import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { COMMANDS_PATH, renderSurfaceUsage } from './commands.definitions.ts';
import { CommandRegistry } from './commands.registry.ts';
import { $CommandRequestBody } from './commands.schemas.ts';
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
    const command = $CommandRequestBody.parse(body);
    const resolved = this.commandRegistry.resolve(command.text);
    if (!resolved) {
      return { response_type: 'ephemeral', text: renderSurfaceUsage() };
    }
    const response = await this.commandsService.run(resolved.handler, {
      channelId: command.channel_id,
      text: resolved.text,
      username: command.user_name
    });
    return { response_type: response.responseType, text: response.text };
  }
}
