import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';

import { $TriggerIntakeBody } from './triggers.schemas.ts';
import { TriggersService } from './triggers.service.ts';

@Controller('triggers')
export class TriggersController {
  constructor(private readonly triggersService: TriggersService) {}

  @HttpCode(202)
  @Post()
  async intake(@Body() body: unknown): Promise<{ id: string }> {
    const recorded = await this.triggersService.record($TriggerIntakeBody.parse(body));
    if (!recorded.success) {
      throw new BadRequestException(recorded.error);
    }
    return { id: recorded.value.id };
  }
}
