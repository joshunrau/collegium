import { Result } from '@collegium/core/utils';

import type { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import type { ActingHuman, PendingDecisionFailure } from './decisions.types.ts';

type PresenceFailure = PendingDecisionFailure.ApproverNotHuman | PendingDecisionFailure.ApproverNotPresent;

/**
 * §3.7 — "any human present in the channel", the one predicate an approval decision and an ask
 * answer both resolve against. Both halves are checked against the user id, and the username is
 * read back from that id rather than taken from the request body, which anything reaching the port
 * could otherwise choose for itself.
 */
export async function resolveActingHuman(
  transportRegistry: TransportRegistry,
  agentUsername: string,
  channelId: string,
  userId: string
): Promise<Result<ActingHuman, PresenceFailure>> {
  const transport = transportRegistry.get(agentUsername);
  const described = await transport.describeUser(userId);
  if (!described.success) {
    return Result.err({ kind: 'approver-not-present', username: userId });
  }
  const membership = await transport.isChannelMember(channelId, userId);
  if (!membership.success || !membership.value) {
    return Result.err({ kind: 'approver-not-present', username: described.value.username });
  }
  if (described.value.isBot) {
    return Result.err({ kind: 'approver-not-human', username: described.value.username });
  }
  return Result.ok({ username: described.value.username });
}
