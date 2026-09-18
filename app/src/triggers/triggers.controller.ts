import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { TriggerTokenGuard } from './trigger-token.guard.ts';
import { $TriggerIntakeBody } from './triggers.schemas.ts';
import { TriggersService } from './triggers.service.ts';

@Controller('triggers')
@UseGuards(TriggerTokenGuard)
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
