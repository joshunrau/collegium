import type { AgentDefinition } from '@collegium/config';

import { ChatGateway } from '@/chat/chat.gateway.ts';

import { nextOccurrence } from './schedules.utils.ts';

import type { ScheduleRuntime, UpcomingSchedule } from './schedules.types.ts';

/** every agent's declared schedules, with the deployment's timezone for those that name none */
export type DeclaredSchedules = {
  readonly agents: readonly AgentDefinition[];
  readonly defaultTimezone: string;
};

/**
 * Which schedules exist is decided in `resolve` and nowhere downstream: config is the only place
 * one is declared (§9), so nothing here creates, changes or removes one. The constructor is private
 * because the announcement channel is named by handle, and only the substrate can turn one into the
 * id the ticker records against — an instance holding unresolved handles is not a state this can be
 * in.
 */
export class SchedulesRegistry {
  private constructor(private readonly schedules: readonly ScheduleRuntime[]) {}

  static async resolve(
    chatGateway: Pick<ChatGateway, 'resolveChannelId'>,
    { agents, defaultTimezone }: DeclaredSchedules
  ): Promise<SchedulesRegistry> {
    const declared = agents.flatMap((agent) => {
      return Object.entries(agent.schedules).map(([handle, declaration]) => ({ agent, declaration, handle }));
    });
    const resolved = await Promise.all(
      declared.map(async ({ agent, declaration, handle }): Promise<ScheduleRuntime> => {
        return {
          agentUsername: agent.username,
          channel: declaration.channel,
          channelId: await chatGateway.resolveChannelId(declaration.channel),
          handle,
          id: `${agent.username}:${handle}`,
          prompt: declaration.prompt,
          recurrence: declaration.recurrence,
          timezone: declaration.timezone ?? defaultTimezone
        };
      })
    );
    return new SchedulesRegistry(resolved);
  }

  list(): readonly ScheduleRuntime[] {
    return this.schedules;
  }

  listUpcomingFor(agentUsername: string, from: Date): readonly UpcomingSchedule[] {
    return this.schedules
      .filter((schedule) => schedule.agentUsername === agentUsername)
      .map(({ channel, handle, recurrence, timezone }) => ({
        channel,
        handle,
        nextOccurrenceAt: nextOccurrence(recurrence, timezone, from)
      }));
  }
}
